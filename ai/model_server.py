#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Serveur API Flask utilisé pour communiquer avec Ollama pour le traitement NLP.
Ce serveur expose des endpoints pour analyser les messages, valider des réponses
et effectuer des vérifications de santé.
"""

import os
import re
import json
import logging
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS

# --- Configuration du logging ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# --- Initialisation de l'application Flask ---
app = Flask(__name__)
CORS(app)

# --- Configuration Ollama ---
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_TAGS_URL = f"{OLLAMA_HOST}/api/tags"
OLLAMA_GENERATE_URL = f"{OLLAMA_HOST}/api/generate"
DEFAULT_MODEL = os.environ.get("OLLAMA_MODEL", "mistral")

def check_ollama_running():
    """
    Vérifie que le serveur Ollama répond sur l'endpoint des tags.
    """
    try:
        resp = requests.get(OLLAMA_TAGS_URL, timeout=5)
        return resp.status_code == 200
    except requests.RequestException as e:
        logger.error(f"Erreur de connexion à Ollama: {e}")
        return False

def query_ollama(prompt: str, model: str = DEFAULT_MODEL) -> str:
    """
    Envoie un prompt à Ollama et renvoie la réponse textuelle.
    """
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False
    }
    try:
        resp = requests.post(OLLAMA_GENERATE_URL, json=payload, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        return data.get("response", "")
    except requests.RequestException as e:
        logger.error(f"Erreur lors de l'appel à Ollama: {e}")
        return f"Erreur: {str(e)}"

def extract_json_from_text(text: str) -> dict:
    """
    Extrait le premier objet JSON valide trouvé dans un texte, en nettoyant
    les commentaires et les virgules traînantes.
    """
    try:
        # supprimer commentaires single-line
        text = re.sub(r'//.*?(\n|$)', '', text)
        # supprimer commentaires multi-line
        text = re.sub(r'/\*.*?\*/', '', text, flags=re.DOTALL)

        # chercher un JSON complet
        match = re.search(r'(\{.*\})', text, flags=re.DOTALL)
        if match:
            js = match.group(1)
            # supprimer virgules traînantes
            js = re.sub(r',\s*}', '}', js)
            js = re.sub(r',\s*]', ']', js)
            # s'assurer que les clés sont entre guillemets
            js = re.sub(r'(\w+)\s*:', r'"\1":', js)
            return json.loads(js)
    except Exception as e:
        logger.error(f"Erreur d'extraction JSON: {e}")
    logger.warning(f"Aucun JSON valide extrait de: {text}")
    return {}

# --- Endpoints ---

@app.route("/", methods=["GET"])
def root():
    """Health check pour la racine."""
    return jsonify({"status": "ok"}), 200

@app.route("/api/health", methods=["GET"])
def api_health():
    """Endpoint de health-check version API."""
    running = check_ollama_running()
    return jsonify({
        "status": "ok" if running else "error",
        "ollama_running": running
    }), 200

@app.route("/health", methods=["GET"])
def legacy_health():
    """Endpoint de compatibilité pour /health."""
    return api_health()

@app.route("/api/analyze", methods=["POST"])
def analyze_message():
    """
    Analyse le message utilisateur et retourne un JSON structuré avec :
      - intent, contains_location, location_name, contains_age, age_value,
        service_type, scheduling_info.
    """
    data = request.get_json(silent=True)
    if not data or "message" not in data:
        return jsonify({"error": "No message provided"}), 400

    message = data["message"]
    prompt = f"""
Analyze the following message in a WhatsApp conversation:
\"{message}\"

Return only a JSON with the following keys:
1. intent: One of [greeting, location, age, service_selection, scheduling, confirmation, unclear]
2. contains_location: true/false
3. location_name: string or null
4. contains_age: true/false
5. age_value: integer or null
6. service_type: One of [option_a, option_b, express, none]
7. scheduling_info: string or null

Your JSON response only, no explanations.
"""

    # appel à Ollama
    response_text = query_ollama(prompt)
    analysis = extract_json_from_text(response_text)

    # fallback si pas de JSON extrait
    if not analysis:
        logger.warning(f"Impossible d'extraire analyse valide de : {response_text}")
        analysis = {
            "intent": "unclear",
            "contains_location": False,
            "location_name": None,
            "contains_age": False,
            "age_value": None,
            "service_type": "none",
            "scheduling_info": None
        }
        # détection basique d'âge
        age_match = re.search(r"\b(\d{1,2})\b", message)
        if age_match:
            analysis["contains_age"] = True
            analysis["age_value"] = int(age_match.group(1))
            analysis["intent"] = "age"
        # détection basique de lieu
        cities = ["Paris", "Lyon", "Marseille", "Toulouse", "Bordeaux",
                  "Lille", "Strasbourg", "Nantes", "Montpellier",
                  "Cernay", "Mulhouse"]
        for city in cities:
            if city.lower() in message.lower():
                analysis["contains_location"] = True
                analysis["location_name"] = city
                analysis["intent"] = "location"
                break

    return jsonify(analysis), 200

@app.route("/api/validate", methods=["POST"])
def validate_message():
    """
    Valide la réponse utilisateur pour l'étape courante, retourne :
      - is_valid, confidence, extracted_info, suggested_next_step.
    """
    data = request.get_json(silent=True)
    if not data or "message" not in data or "context" not in data:
        return jsonify({"error": "Missing message or context"}), 400

    message = data["message"]
    context = data["context"]
    current = context.get("currentStep", "unknown")

    prompt = f"""
Analyze this message in a WhatsApp conversation:
\"{message}\"

Current conversation stage: {current}

Return only a JSON with:
1. is_valid: true/false
2. confidence: 0-100
3. extracted_info: object
4. suggested_next_step: string

Your JSON response only.
"""

    response_text = query_ollama(prompt)
    validation = extract_json_from_text(response_text)

    if not validation:
        logger.warning(f"Impossible d'extraire validation valide de : {response_text}")
        validation = {
            "is_valid": True,
            "confidence": 50,
            "extracted_info": {},
            "suggested_next_step": current
        }

    return jsonify(validation), 200

@app.route("/generate", methods=["POST"])
def generate():
    """
    Génération directe d'une réponse via Ollama (compatibilité).
    Attends un JSON { "prompt": "...", "model": "..." }.
    """
    data = request.get_json(silent=True) or {}
    prompt = data.get("prompt", "")
    model  = data.get("model", DEFAULT_MODEL)

    if not prompt:
        return jsonify({"error": "Le prompt est requis"}), 400

    result = query_ollama(prompt, model)
    return jsonify({"response": result}), 200

# --- Lancement du serveur ---
if __name__ == "__main__":
    if not check_ollama_running():
        logger.warning("⚠️ Ollama n'est pas en cours d'exécution !")
        logger.warning("Lancez-le avec : `ollama serve` dans un autre terminal.")
    port = int(os.environ.get("FLASK_PORT", 5000))
    logger.info(f"Démarrage du serveur NLP sur le port {port}")
    app.run(host="0.0.0.0", port=port, debug=False)
