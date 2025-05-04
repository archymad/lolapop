"""
Serveur API Flask utilisé pour communiquer avec Ollama pour le traitement NLP
Ce serveur expose des endpoints pour analyser les messages et les intentions utilisateurs
"""

from flask import Flask, request, jsonify
import requests
import json
import os
import logging
import re

# Configuration du logging
logging.basicConfig(level=logging.INFO, 
                   format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Configuration Ollama
OLLAMA_URL = "http://localhost:11434/api/generate"
DEFAULT_MODEL = "mistral"  # Par défaut: mistral

# Vérifier que Ollama est en cours d'exécution
def check_ollama_running():
    try:
        response = requests.get("http://localhost:11434/api/tags")
        return response.status_code == 200
    except requests.exceptions.ConnectionError:
        return False

# Fonction pour interroger Ollama
def query_ollama(prompt, model=DEFAULT_MODEL):
    try:
        response = requests.post(
            OLLAMA_URL,
            json={
                "model": model,
                "prompt": prompt,
                "stream": False
            }
        )
        
        if response.status_code == 200:
            return response.json().get("response", "")
        else:
            logger.error(f"Erreur Ollama: {response.status_code} - {response.text}")
            return f"Erreur: {response.status_code}"
    except Exception as e:
        logger.error(f"Exception lors de l'appel à Ollama: {e}")
        return f"Erreur: {str(e)}"

# Extraire du JSON d'une réponse texte
def extract_json_from_text(text):
    try:
        # Supprimer les commentaires du texte
        text = re.sub(r'//.*?(\n|$)', '', text)
        
        # Supprimer les commentaires multilignes
        text = re.sub(r'/\*.*?\*/', '', text, flags=re.DOTALL)
        
        # Chercher un objet JSON dans la réponse
        json_match = re.search(r'({.*})', text, re.DOTALL)
        if json_match:
            json_str = json_match.group(1)
            # Nettoyer le JSON pour s'assurer qu'il est valide
            # Supprimer les virgules trailing
            json_str = re.sub(r',\s*}', '}', json_str)
            json_str = re.sub(r',\s*]', ']', json_str)
            
            # S'assurer que les noms de propriétés sont entre guillemets
            json_str = re.sub(r'(\s*)(\w+)(\s*):([^:])', r'\1"\2"\3:\4', json_str)
            
            return json.loads(json_str)
        
        # Si aucun JSON n'est trouvé, essayer un autre format
        clean_text = re.sub(r'[\r\n\t]', ' ', text)
        json_match = re.search(r'{[^{}]*}', clean_text)
        if json_match:
            try:
                return json.loads(json_match.group(0))
            except:
                pass
                
        logger.warning(f"Aucun JSON trouvé dans : {text}")
        return {}
    except Exception as e:
        logger.error(f"Erreur lors de l'extraction du JSON: {e}")
        logger.error(f"Texte qui a causé l'erreur: {text}")
        return {}

# Analyser l'intention d'un message
@app.route('/api/analyze', methods=['POST'])
def analyze_message():
    try:
        data = request.json
        if not data or 'message' not in data:
            return jsonify({"error": "No message provided"}), 400
        
        message = data['message']
        
        prompt = f"""
        Analyze the following message in a WhatsApp conversation:
        "{message}"
        
        Return only a JSON with the following keys:
        1. intent: One of [greeting, location, age, service_selection, scheduling, confirmation, unclear]
        2. contains_location: true/false - Does the message mention a specific location?
        3. location_name: If location detected, extract it, otherwise null
        4. contains_age: true/false - Does the message mention an age?
        5. age_value: If age detected, extract it as integer, otherwise null
        6. service_type: One of [option_a, option_b, express, none] if a service is chosen
        7. scheduling_info: Extract any scheduling information, or null
        
        Your JSON response (without any comments or explanations):
        """
        
        # Interroger Ollama
        response_text = query_ollama(prompt)
        
        # Extraire le JSON de la réponse
        analysis_data = extract_json_from_text(response_text)
        
        # Si l'extraction échoue, fournir une analyse par défaut
        if not analysis_data:
            logger.warning(f"Impossible d'extraire une analyse valide de: {response_text}")
            analysis_data = {
                "intent": "unclear",
                "contains_location": False,
                "location_name": None,
                "contains_age": False,
                "age_value": None,
                "service_type": "none",
                "scheduling_info": None
            }
            
            # Tentative d'analyse basique
            if re.search(r'\b\d{1,2}\b', message):
                analysis_data["contains_age"] = True
                age_match = re.search(r'\b(\d{1,2})\b', message)
                if age_match:
                    analysis_data["age_value"] = int(age_match.group(1))
                    analysis_data["intent"] = "age"
            
            # Détection basique de lieu
            cities = ["Paris", "Lyon", "Marseille", "Toulouse", "Bordeaux", "Lille", "Strasbourg", 
                    "Nantes", "Montpellier", "Cernay", "Mulhouse"]
            for city in cities:
                if city.lower() in message.lower():
                    analysis_data["contains_location"] = True
                    analysis_data["location_name"] = city
                    analysis_data["intent"] = "location"
                    break
        
        return jsonify(analysis_data)
    
    except Exception as e:
        logger.error(f"Erreur lors de l'analyse du message: {e}")
        return jsonify({
            "intent": "unclear",
            "contains_location": False,
            "location_name": None,
            "contains_age": False,
            "age_value": None,
            "service_type": "none",
            "scheduling_info": None
        })

# Valider une réponse utilisateur
@app.route('/api/validate', methods=['POST'])
def validate_message():
    try:
        data = request.json
        if not data or 'message' not in data or 'context' not in data:
            return jsonify({"error": "Missing message or context"}), 400
        
        message = data['message']
        context = data['context']
        
        prompt = f"""
        Analyze this message in a WhatsApp conversation:
        "{message}"
        
        Current conversation stage: {context.get('currentStep', 'unknown')}
        
        Return only a JSON with the following keys (without any comments):
        1. is_valid: true/false - Is the response valid for the current stage?
        2. confidence: 0-100 - How confident are you in this assessment?
        3. extracted_info: Any relevant information extracted (location, age, service choice, etc.)
        4. suggested_next_step: What should be the next conversation stage?
        
        Your JSON response:
        """
        
        # Interroger Ollama
        response_text = query_ollama(prompt)
        
        # Extraire le JSON de la réponse
        validation_data = extract_json_from_text(response_text)
        
        # Si l'extraction échoue, fournir une validation par défaut
        if not validation_data:
            logger.warning(f"Impossible d'extraire une validation valide de: {response_text}")
            validation_data = {
                "is_valid": True,  # Par défaut, accepter la réponse
                "confidence": 50,
                "extracted_info": {},
                "suggested_next_step": context.get('currentStep', 'unknown')
            }
        
        return jsonify(validation_data)
    
    except Exception as e:
        logger.error(f"Erreur lors de la validation du message: {e}")
        return jsonify({
            "is_valid": True,
            "confidence": 0,
            "extracted_info": {},
            "suggested_next_step": context.get('currentStep', 'unknown')
        })

# Route pour la génération directe (compatible avec l'ancien endpoint)
@app.route('/generate', methods=['POST'])
def generate():
    try:
        data = request.json
        prompt = data.get('prompt', '')
        model = data.get('model', DEFAULT_MODEL)
        
        if not prompt:
            return jsonify({"error": "Le prompt est requis"}), 400
            
        response = query_ollama(prompt, model)
        return jsonify({"response": response})
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# Vérification de la santé du serveur
@app.route('/api/health', methods=['GET'])
def health_check():
    ollama_running = check_ollama_running()
    
    return jsonify({
        "status": "ok" if ollama_running else "error",
        "ollama_running": ollama_running
    })

# Route de compatibilité
@app.route('/health', methods=['GET'])
def legacy_health_check():
    return health_check()

if __name__ == '__main__':
    # Vérifier si Ollama est en cours d'exécution
    if not check_ollama_running():
        logger.warning("⚠️ Ollama n'est pas en cours d'exécution ! Le service ne fonctionnera pas correctement.")
        logger.warning("Lancez Ollama avec la commande 'ollama serve' dans un autre terminal.")
    
    port = int(os.environ.get('FLASK_PORT', 5000))
    
    logger.info(f"Démarrage du serveur NLP sur le port {port}")
    app.run(host='0.0.0.0', port=port, debug=False)