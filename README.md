# VitalVox Medical Chatbot

VitalVox is a Flask-based medical RAG web application with:

- a multipage UI (`Home`, `Platform`, `Assistant`)
- Pinecone-backed document retrieval
- Gemini and Ollama model support
- a chat workspace with source previews and runtime health checks

## Tech Stack

- Python
- Flask
- LangChain
- Pinecone
- Google Gemini
- Ollama (optional)

## Project Structure

```text
.
|-- app.py
|-- store_index.py
|-- requirements.txt
|-- data/
|-- src/
|-- static/
`-- templates/
```

## Prerequisites

Install these first:

- Python 3.10 or newer
- Git
- A Pinecone account and API key
- A Gemini API key if you want to use Gemini models
- Ollama if you want to use local models

## 1. Clone the Project

```bash
git clone https://github.com/kawsar07ahmmed0712-rgb/End_to_End_Medical_Chatbot.git
cd End_to_End_Medical_Chatbot
```

## 2. Create and Activate a Virtual Environment

### Conda

```bash
conda create -n vitalvox python=3.10 -y
conda activate vitalvox
```

### Or venv

```bash
python -m venv .venv
```

Windows:

```bash
.venv\Scripts\activate
```

macOS/Linux:

```bash
source .venv/bin/activate
```

## 3. Install Dependencies

```bash
pip install -r requirements.txt
```

## 4. Add Your Environment Variables

Create a `.env` file in the project root.

Example:

```env
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX_NAME=medical-chatbot

GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
GEMINI_MODELS=gemini-2.5-flash

OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODELS=gemma3:4b,gemma3:1b

PORT=8080
FLASK_DEBUG=true
```

### Notes

- `PINECONE_API_KEY` is required.
- `GEMINI_API_KEY` is required only if you want Gemini models.
- Ollama settings are required only if you want local Ollama models.
- If you use only Gemini, you can ignore Ollama.
- If you use only Ollama, make sure Ollama is running and the selected models are installed.

## 5. Add PDF Files

Put your medical PDF files inside the `data/` folder.

Example:

```text
data/
|-- file1.pdf
|-- file2.pdf
`-- file3.pdf
```

## 6. Build the Pinecone Index

Run this once after adding or updating PDFs:

```bash
python store_index.py
```

This script:

- loads PDFs from `data/`
- splits them into chunks
- creates the Pinecone index if it does not already exist
- uploads the embeddings to Pinecone

## 7. Optional: Start Ollama

If you want to use Ollama models, start Ollama first.

Example:

```bash
ollama serve
```

Then install a model if needed:

```bash
ollama pull gemma3:4b
```

## 8. Run the Web Application

```bash
python app.py
```

The app will start on:

```text
http://127.0.0.1:8080
```

## 9. Open the Website

Open these routes in your browser:

- `http://127.0.0.1:8080/`
- `http://127.0.0.1:8080/platform`
- `http://127.0.0.1:8080/assistant`

## API Endpoints

- `GET /api/models` - available model catalog
- `GET /health` - runtime and knowledge-base status
- `POST /api/chat` - main chat endpoint
- `GET/POST /get` - legacy chat endpoint

## Common Run Flow

```bash
pip install -r requirements.txt
python store_index.py
python app.py
```

Then open:

```text
http://127.0.0.1:8080
```

## Troubleshooting

### Pinecone error

Check:

- `PINECONE_API_KEY` is set correctly
- your internet connection is working
- the index name matches `PINECONE_INDEX_NAME`

### Gemini not available

Check:

- `GEMINI_API_KEY` exists in `.env`
- the Gemini model name is valid

### Ollama not available

Check:

- Ollama is running
- `OLLAMA_BASE_URL` is correct
- the model is installed locally

### Chat not answering

Check:

- you already ran `python store_index.py`
- the `data/` folder contains PDFs
- Pinecone index creation completed successfully
- `/health` shows the system is ready

## Development Notes

- Main Flask app: `app.py`
- Pinecone indexing script: `store_index.py`
- UI templates: `templates/`
- CSS and JavaScript: `static/`

## License

This project includes the repository `LICENSE` file.
