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
          
          // Normaliser l'entrée
          const normalizedLocation = location.toLowerCase().trim();
          
          // Liste des villes et villages connus
          const locationsData = geoConfig.locations || {};
          
          // Vérifier si la localisation correspond à une ville connue (insensible à la casse)
          for (const city in locationsData) {
            if (city.toLowerCase() === normalizedLocation) {
              // Si c'est une ville connue, choisir un village aléatoire
              const villages = locationsData[city].villages || [];
              if (villages.length > 0) {
                return villages[Math.floor(Math.random() * villages.length)];
              }
            }
          }
          
          // Chercher si la localisation est un village référencé
          for (const city in locationsData) {
            const villages = locationsData[city].villages || [];
            for (const village of villages) {
              if (village.toLowerCase() === normalizedLocation) {
                // C'est un village connu, retourner un autre village de la même ville
                const otherVillages = villages.filter(v => v.toLowerCase() !== normalizedLocation);
                if (otherVillages.length > 0) {
                  return otherVillages[Math.floor(Math.random() * otherVillages.length)];
                }
                // Si pas d'autre village, retourner la ville
                return city;
              }
            }
          }
          
          // Si on arrive ici, c'est que la ville n'est pas connue.
          // On va essayer de trouver une ville connue qui a été fournie précédemment
          if (this.lastKnownCity) {
            const lastCityData = locationsData[this.lastKnownCity];
            if (lastCityData && lastCityData.villages && lastCityData.villages.length > 0) {
              return lastCityData.villages[Math.floor(Math.random() * lastCityData.villages.length)];
            }
          }
          
          // Si on est arrivé à l'étape step_2_response, c'est que l'utilisateur a fourni une ville valide
          // Dans ce cas, essayons de récupérer un village aléatoire d'une ville aléatoire
          const cities = Object.keys(locationsData);
          if (cities.length > 0) {
            const randomCity = cities[Math.floor(Math.random() * cities.length)];
            const villages = locationsData[randomCity].villages || [];
            if (villages.length > 0) {
              return villages[Math.floor(Math.random() * villages.length)];
            }
            return randomCity;
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
