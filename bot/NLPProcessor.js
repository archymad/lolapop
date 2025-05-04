/**
 * Interface avec le serveur NLP
 */

const axios = require('axios');

class NLPProcessor {
  constructor(aiConfig, serverUrl = null) {
    this.config = aiConfig;
    this.serverUrl = serverUrl || this.config.ollama.serverUrl.replace('/api/generate', '') || 'http://localhost:5000';
  }
  
  /**
   * Analyser l'intention d'un message
   */
  async analyzeMessage(message, context = {}) {
    try {
      const response = await axios.post(`${this.serverUrl}/api/analyze`, {
        message: message
      });
      
      return response.data;
    } catch (error) {
      console.error('Erreur lors de l\'analyse NLP:', error.message);
      
      // Retourner une intention par défaut en cas d'erreur
      return {
        intent: "unclear",
        contains_location: false,
        location_name: null,
        contains_age: false,
        age_value: null,
        service_type: "none",
        scheduling_info: null
      };
    }
  }
  
  /**
   * Valider une réponse utilisateur pour une étape donnée
   */
  async validateResponse(message, context) {
    try {
      const response = await axios.post(`${this.serverUrl}/api/validate`, {
        message: message,
        context: context
      });
      
      return response.data;
    } catch (error) {
      console.error('Erreur lors de la validation NLP:', error.message);
      
      // Retourner un résultat par défaut en cas d'erreur
      return {
        is_valid: false,
        confidence: 0,
        extracted_info: {},
        suggested_next_step: context.currentStep
      };
    }
  }
  
  /**
   * Vérifier la santé du serveur NLP
   */
  async checkHealth() {
    try {
      const response = await axios.get(`${this.serverUrl}/api/health`);
      return response.data;
    } catch (error) {
      console.error('Erreur lors de la vérification de santé du serveur NLP:', error.message);
      return {
        status: 'error',
        message: error.message
      };
    }
  }
}

module.exports = NLPProcessor;