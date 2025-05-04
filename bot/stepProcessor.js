/**
 * Traitement des étapes du scénario
 */

/**
 * Charger le processeur d'étapes
 * @param {Object} configurator - Instance du configurateur
 * @returns {Object} Processeur d'étapes
 */
function loadStepProcessor(configurator) {
    // Charger les configurations
    const scenarioConfig = configurator.getConfig('scenario');
    const personalityConfig = configurator.getConfig('personality');
    const botConfig = configurator.getConfig('bot');
    
    // Scénario actif
    const activeScenario = botConfig.scenario.active;
    const scenario = scenarioConfig.scenarios[activeScenario];
    
    if (!scenario) {
      throw new Error(`Scénario non trouvé: ${activeScenario}`);
    }
    
    // Processeur d'étapes
    return {
      // Obtenir une étape par son ID
      getStepById: function(stepId) {
        return scenario.steps[stepId];
      },
      
      // Obtenir toutes les étapes
      getAllSteps: function() {
        return scenario.steps;
      },
      
      // Obtenir l'étape initiale
      getInitialStep: function() {
        return scenario.startStep || Object.keys(scenario.steps)[0];
      },
      
      // Personnaliser un message
      personalizeMessage: function(message, userData) {
        if (!message) return "";
        
        let result = message;
        
        // Remplacer les marqueurs par les données utilisateur
        if (result.includes('{{location}}') && userData.location) {
          result = result.replace('{{location}}', userData.location);
        }
        
        if (result.includes('{{nearby_village}}') && userData.location) {
          // Cette fonction serait implémentée ailleurs
          const nearbyVillage = this.findNearbyVillage(userData.location);
          result = result.replace('{{nearby_village}}', nearbyVillage || "près d'ici");
        }
        
        if (result.includes('{{age}}') && userData.age) {
          result = result.replace('{{age}}', userData.age);
        }
        
        // Appliquer les règles de personnalité (à implémenter)
        // ...
        
        return result;
      },
      
      // Obtenir l'étape suivante en fonction de l'âge
      getAgeResponseStep: function(age) {
        if (!age || isNaN(age)) {
          return 'step3_response_default';
        }
        
        if (age < 19) {
          return 'step3_response_young';
        } else if (age >= 19 && age <= 30) {
          return 'step3_response_similar';
        } else {
          return 'step3_response_older';
        }
      },
      
      // Trouver un village proche d'une ville
      findNearbyVillage: function(location) {
        try {
          // Charger les données géographiques
          const geoConfig = configurator.getConfig('geo');
          
          // Vérifier si la localisation est directement une clé
          if (geoConfig[location] && geoConfig[location].length > 0) {
            const villages = geoConfig[location];
            return villages[Math.floor(Math.random() * villages.length)];
          }
          
          // Chercher si la localisation est un village référencé
          for (const city in geoConfig) {
            if (geoConfig[city].includes(location)) {
              // Si c'est le cas, retourner un autre village de la même ville
              const otherVillages = geoConfig[city].filter(v => v !== location);
              if (otherVillages.length > 0) {
                return otherVillages[Math.floor(Math.random() * otherVillages.length)];
              }
            }
          }
          
          // Fallback: retourner un village aléatoire
          const allCities = Object.keys(geoConfig);
          if (allCities.length > 0) {
            const randomCity = allCities[Math.floor(Math.random() * allCities.length)];
            const villages = geoConfig[randomCity];
            return villages[Math.floor(Math.random() * villages.length)];
          }
        } catch (error) {
          console.error('Erreur lors de la recherche du village:', error);
        }
        
        return "un village pas loin";
      }
    };
  }
  
  module.exports = {
    loadStepProcessor
  };