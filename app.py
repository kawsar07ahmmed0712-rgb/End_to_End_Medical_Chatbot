import os
import time
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

from src.prompt import system_prompt


load_dotenv()

app = Flask(__name__)

SITE_NAME = "VitalVox"
INDEX_NAME = os.getenv("PINECONE_INDEX_NAME", "medical-chatbot")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
DEFAULT_OLLAMA_MODELS = (
    "gemma3:4b",
    "gemma3:1b",
    "deepseek-v3.1:671b-cloud",
    "gpt-oss:120b-cloud",
)
MAX_HISTORY_TURNS = 8
GENERIC_CHAT_ERROR = (
    "The assistant is temporarily unavailable. Check the runtime configuration and try again."
)


def _parse_csv_env(name: str, fallback: list[str]) -> list[str]:
    raw_value = os.getenv(name, "")
    values = [item.strip() for item in raw_value.split(",") if item.strip()]
    return values or fallback


def _require_env_var(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _make_model_id(provider: str, model: str) -> str:
    return f"{provider}|{model}"


def _format_docs(documents) -> str:
    return "\n\n".join(document.page_content for document in documents)


def _display_model_name(model: str) -> str:
    replacements = {
        "gemini": "Gemini",
        "gemma": "Gemma",
        "deepseek": "DeepSeek",
        "gpt": "GPT",
        "oss": "OSS",
        "flash": "Flash",
        "cloud": "Cloud",
    }
    label = model.replace(":", " / ").replace("-", " ")
    for source, target in replacements.items():
        label = label.replace(source, target)
    return label


def _ollama_inventory() -> dict[str, Any]:
    endpoint = f"{OLLAMA_BASE_URL.rstrip('/')}/api/tags"
    try:
        response = requests.get(endpoint, timeout=3)
        response.raise_for_status()
        models = response.json().get("models", [])
    except requests.RequestException:
        return {"online": False, "models": []}

    model_names = [model.get("name") for model in models if model.get("name")]
    return {"online": True, "models": model_names}


def get_model_catalog() -> list[dict[str, Any]]:
    gemini_models = _parse_csv_env("GEMINI_MODELS", [GEMINI_MODEL])
    gemini_ready = bool(os.getenv("GEMINI_API_KEY"))

    catalog = [
        {
            "id": _make_model_id("gemini", model_name),
            "provider": "gemini",
            "provider_label": "Google Gemini",
            "model": model_name,
            "label": _display_model_name(model_name),
            "description": "Cloud model with Pinecone-backed medical retrieval.",
            "available": gemini_ready,
            "status_text": "API key ready" if gemini_ready else "Missing GEMINI_API_KEY",
        }
        for model_name in gemini_models
    ]

    inventory = _ollama_inventory()
    configured_ollama_models = _parse_csv_env(
        "OLLAMA_MODELS",
        inventory["models"][:4] or list(DEFAULT_OLLAMA_MODELS),
    )
    installed_models = set(inventory["models"])

    for model_name in configured_ollama_models:
        is_available = inventory["online"] and model_name in installed_models
        if inventory["online"] and not installed_models:
            status_text = "Ollama is online, but no models were found"
        elif is_available:
            status_text = "Ready in local Ollama runtime"
        elif inventory["online"]:
            status_text = "Configured, but not currently installed in Ollama"
        else:
            status_text = "Ollama server is offline"

        catalog.append(
            {
                "id": _make_model_id("ollama", model_name),
                "provider": "ollama",
                "provider_label": "Ollama",
                "model": model_name,
                "label": _display_model_name(model_name),
                "description": "Local or Ollama-hosted model routed through the same RAG pipeline.",
                "available": is_available,
                "status_text": status_text,
            }
        )

    return catalog


def _get_default_model_id(models: list[dict[str, Any]] | None = None) -> str | None:
    catalog = models or get_model_catalog()
    for model in catalog:
        if model["available"]:
            return model["id"]
    return catalog[0]["id"] if catalog else None


def _get_model_config(model_id: str | None) -> dict[str, Any]:
    catalog = get_model_catalog()
    resolved_id = model_id or _get_default_model_id(catalog)
    if not resolved_id:
        raise ValueError("No models are configured for this chatbot.")

    for model in catalog:
        if model["id"] == resolved_id:
            return model

    raise ValueError("The selected model is not available in the current catalog.")


def render_page(
    template_name: str,
    *,
    title: str,
    description: str,
    active_nav: str,
    page_script: str | None = None,
):
    return render_template(
        template_name,
        site_name=SITE_NAME,
        page_title=title,
        page_description=description,
        active_nav=active_nav,
        page_script=page_script,
        current_year=datetime.now().year,
    )


def _wants_json_error() -> bool:
    if request.path.startswith("/api/"):
        return True

    accepts = request.accept_mimetypes
    return accepts.accept_json and not accepts.accept_html


@lru_cache(maxsize=1)
def get_retriever():
    try:
        from langchain_pinecone import PineconeVectorStore

        from src.helper import download_hugging_face_embeddings
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "Missing dependency while building the chatbot. Install the project requirements first."
        ) from exc

    pinecone_api_key = _require_env_var("PINECONE_API_KEY")
    os.environ.setdefault("PINECONE_API_KEY", pinecone_api_key)

    embeddings = download_hugging_face_embeddings()
    vector_store = PineconeVectorStore.from_existing_index(
        index_name=INDEX_NAME,
        embedding=embeddings,
    )
    return vector_store.as_retriever(
        search_type="similarity",
        search_kwargs={"k": 3},
    )


@lru_cache(maxsize=16)
def _build_llm(provider: str, model_name: str):
    if provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI

        gemini_api_key = _require_env_var("GEMINI_API_KEY")
        os.environ.setdefault("GEMINI_API_KEY", gemini_api_key)
        return ChatGoogleGenerativeAI(
            model=model_name,
            api_key=gemini_api_key,
            temperature=0.2,
        )

    if provider == "ollama":
        from langchain_ollama import ChatOllama

        return ChatOllama(
            model=model_name,
            base_url=OLLAMA_BASE_URL,
            temperature=0.2,
        )

    raise ValueError(f"Unsupported model provider: {provider}")


@lru_cache(maxsize=16)
def get_generation_chain(provider: str, model_name: str):
    from langchain_core.output_parsers import StrOutputParser
    from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", system_prompt),
            MessagesPlaceholder("chat_history", optional=True),
            ("human", "{input}"),
        ]
    )
    return prompt | _build_llm(provider, model_name) | StrOutputParser()


def _format_history(history: Any):
    from langchain_core.messages import AIMessage, HumanMessage

    if not isinstance(history, list):
        return []

    formatted_history = []
    for item in history[-MAX_HISTORY_TURNS:]:
        if not isinstance(item, dict):
            continue

        role = str(item.get("role", "")).strip().lower()
        content = str(item.get("content", "")).strip()
        if not content:
            continue

        if role == "user":
            formatted_history.append(HumanMessage(content=content))
        elif role == "assistant":
            formatted_history.append(AIMessage(content=content))

    return formatted_history


def _serialize_sources(documents) -> list[dict[str, str]]:
    sources = []
    seen = set()

    for document in documents:
        source_path = str(document.metadata.get("source") or "Knowledge base")
        if source_path in seen:
            continue

        seen.add(source_path)
        preview = " ".join(document.page_content.split())[:180].strip()
        sources.append(
            {
                "name": Path(source_path).name,
                "path": source_path,
                "preview": preview,
            }
        )

    return sources


def generate_response(
    user_message: str,
    model_id: str | None = None,
    history: Any = None,
) -> dict[str, Any]:
    model_config = _get_model_config(model_id)
    if not model_config["available"]:
        raise RuntimeError(model_config["status_text"])

    started_at = time.perf_counter()
    retriever = get_retriever()
    documents = retriever.invoke(user_message)
    answer = get_generation_chain(
        model_config["provider"],
        model_config["model"],
    ).invoke(
        {
            "context": _format_docs(documents),
            "input": user_message,
            "chat_history": _format_history(history),
        }
    )
    latency_ms = int((time.perf_counter() - started_at) * 1000)

    return {
        "answer": str(answer).strip(),
        "model": {
            "id": model_config["id"],
            "provider": model_config["provider"],
            "provider_label": model_config["provider_label"],
            "name": model_config["model"],
            "label": model_config["label"],
        },
        "sources": _serialize_sources(documents),
        "context_count": len(documents),
        "latency_ms": latency_ms,
    }


def get_health_summary() -> dict[str, Any]:
    catalog = get_model_catalog()
    ollama_inventory = _ollama_inventory()
    knowledge_base_ready = True
    knowledge_base_detail = "Pinecone retriever ready"

    try:
        get_retriever()
    except Exception as exc:
        knowledge_base_ready = False
        knowledge_base_detail = str(exc)

    ollama_models = [model for model in catalog if model["provider"] == "ollama"]
    gemini_models = [model for model in catalog if model["provider"] == "gemini"]
    available_model_count = sum(1 for model in catalog if model["available"])

    return {
        "status": "ok" if knowledge_base_ready and available_model_count else "error",
        "ready": knowledge_base_ready and available_model_count > 0,
        "knowledge_base": {
            "ready": knowledge_base_ready,
            "index_name": INDEX_NAME,
            "detail": knowledge_base_detail,
        },
        "providers": {
            "gemini": {
                "configured": any(model["available"] for model in gemini_models),
                "count": len(gemini_models),
            },
            "ollama": {
                "online": ollama_inventory["online"],
                "count": len(ollama_models),
                "installed_count": len(ollama_inventory["models"]),
            },
        },
        "model_count": len(catalog),
        "available_model_count": available_model_count,
    }


@app.route("/")
def index():
    return render_page(
        "index.html",
        title="Clinical AI workspace for faster sourced answers",
        description=(
            "VitalVox helps clinics and medical teams access source-backed answers with "
            "retrieval, model routing, and operational visibility."
        ),
        active_nav="home",
    )


@app.route("/platform")
def platform():
    return render_page(
        "platform.html",
        title="Platform overview for clinics and medical teams",
        description=(
            "Understand how VitalVox combines medical retrieval, model orchestration, "
            "source visibility, and readiness monitoring in one workflow."
        ),
        active_nav="platform",
    )


@app.route("/assistant")
def assistant():
    return render_page(
        "assistant.html",
        title="Assistant workspace",
        description=(
            "Use the VitalVox assistant workspace to run sourced medical queries against "
            "the configured knowledge base and available models."
        ),
        active_nav="assistant",
        page_script="chat-app.js",
    )


@app.route("/api/models")
def model_catalog():
    catalog = get_model_catalog()
    return jsonify(
        {
            "models": catalog,
            "default_model_id": _get_default_model_id(catalog),
        }
    )


@app.route("/health")
def health():
    summary = get_health_summary()
    return jsonify(summary), 200 if summary["ready"] else 503


@app.route("/api/chat", methods=["POST"])
def chat_api():
    payload = request.get_json(silent=True) or {}
    user_message = str(payload.get("message", "")).strip()
    model_id = payload.get("model_id")
    history = payload.get("history", [])

    if not user_message:
        return jsonify({"detail": "Please enter a message."}), 400

    try:
        response = generate_response(user_message, model_id, history)
    except ValueError as exc:
        return jsonify({"detail": str(exc)}), 400
    except Exception as exc:
        app.logger.exception("Chat request failed")
        return jsonify({"detail": GENERIC_CHAT_ERROR}), 500

    return jsonify(response)


@app.route("/get", methods=["GET", "POST"])
def chat():
    user_message = request.values.get("msg", "").strip()
    model_id = request.values.get("model_id")

    if not user_message:
        return "Please enter a message.", 400

    try:
        response = generate_response(user_message, model_id, [])
    except ValueError as exc:
        return str(exc), 400
    except Exception as exc:
        app.logger.exception("Legacy chat request failed")
        return f"Application error: {GENERIC_CHAT_ERROR}", 500

    return response["answer"]


@app.errorhandler(404)
def page_not_found(error):
    if _wants_json_error():
        return jsonify({"detail": "Resource not found."}), 404

    return (
        render_page(
            "404.html",
            title="Page not found",
            description="The page you requested could not be found.",
            active_nav="",
        ),
        404,
    )


@app.errorhandler(500)
def internal_server_error(error):
    app.logger.exception("Unhandled application error: %s", error)

    if _wants_json_error():
        return jsonify({"detail": "Internal server error."}), 500

    return (
        render_page(
            "500.html",
            title="Application error",
            description="The application encountered an unexpected error.",
            active_nav="",
        ),
        500,
    )


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8080")),
        debug=os.getenv("FLASK_DEBUG", "true").lower() == "true",
    )
