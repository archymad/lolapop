/**
 * Utilitaire de gestion de la configuration pour le bot conversationnel
 * Permet de charger, valider, modifier et enregistrer les configurations
 */

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const deepmerge = require('deepmerge');
const chalk = require('chalk');

// Chemins des fichiers de configuration
const CONFIG_PATHS = {
  bot: path.join(__dirname, 'config', 'bot.config.json'),
  personality: path.join(__dirname, 'config', 'personality.json'),
  scenario: path.join(__dirname, 'config', 'scenario.json'),
  ai: path.join(__dirname, 'config', 'ai.config.json'),
  media: path.join(__dirname, 'config', 'media.config.json'),
  geo: path.join(__dirname, 'config', 'geo.config.json')
};

// Chemins des schémas JSON
const SCHEMA_PATHS = {
  bot: path.join(__dirname, 'schemas', 'bot.schema.json'),
  personality: path.join(__dirname, 'schemas', 'personality.schema.json'),
  scenario: path.join(__dirname, 'schemas', 'scenario.schema.json'),
  ai: path.join(__dirname, 'schemas', 'ai.schema.json'),
  media: path.join(__dirname, 'schemas', 'media.schema.json'),
  geo: path.join(__dirname, 'schemas', 'geo.schema.json')
};

class BotConfigurator {
  constructor() {
    this.config = {};
    this.schemas = {};
    this.validator = new Ajv({ allErrors: true });
    this.initialized = false;
  }

  /**
   * Initialiser le configurateur
   */
  async initialize() {
    try {
      // Créer les dossiers de configuration s'ils n'existent pas
      await this.ensureDirectories();
      
      // Charger les schémas
      await this.loadSchemas();
      
      // Charger les configurations
      await this.loadAllConfigs();
      
      this.initialized = true;
      console.log(chalk.green('✓ Configurateur initialisé avec succès'));
      
      return true;
    } catch (error) {
      console.error(chalk.red(`Erreur lors de l'initialisation du configurateur: ${error.message}`));
      return false;
    }
  }

  /**
   * S'assurer que les répertoires nécessaires existent
   */
  async ensureDirectories() {
    const directories = [
      path.join(__dirname, 'config'),
      path.join(__dirname, 'schemas')
    ];

    for (const dir of directories) {
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
        console.log(chalk.blue(`Répertoire créé: ${dir}`));
      }
    }
  }

  /**
   * Charger tous les schémas JSON
   */
  async loadSchemas() {
    try {
      for (const [key, schemaPath] of Object.entries(SCHEMA_PATHS)) {
        if (fs.existsSync(schemaPath)) {
          const schemaData = await fs.promises.readFile(schemaPath, 'utf8');
          this.schemas[key] = JSON.parse(schemaData);
          this.validator.addSchema(this.schemas[key], key);
        } else {
          console.warn(chalk.yellow(`Schéma non trouvé: ${schemaPath}`));
        }
      }
    } catch (error) {
      throw new Error(`Erreur lors du chargement des schémas: ${error.message}`);
    }
  }

  /**
   * Charger toutes les configurations
   */
  async loadAllConfigs() {
    try {
      for (const [key, configPath] of Object.entries(CONFIG_PATHS)) {
        await this.loadConfig(key, configPath);
      }
    } catch (error) {
      throw new Error(`Erreur lors du chargement des configurations: ${error.message}`);
    }
  }

  /**
   * Charger une configuration spécifique
   * @param {string} configKey - Clé de la configuration
   * @param {string} configPath - Chemin du fichier de configuration
   */
  async loadConfig(configKey, configPath) {
    try {
      if (fs.existsSync(configPath)) {
        const configData = await fs.promises.readFile(configPath, 'utf8');
        this.config[configKey] = JSON.parse(configData);
        console.log(chalk.green(`✓ Configuration '${configKey}' chargée`));
      } else {
        console.warn(chalk.yellow(`Configuration non trouvée: ${configPath}`));
        this.config[configKey] = {};
      }
    } catch (error) {
      console.error(chalk.red(`Erreur lors du chargement de la configuration '${configKey}': ${error.message}`));
      this.config[configKey] = {};
    }
  }

  /**
   * Valider une configuration selon son schéma
   * @param {string} configKey - Clé de la configuration
   * @returns {Object} Résultat de la validation
   */
  validateConfig(configKey) {
    if (!this.schemas[configKey]) {
      return { valid: false, errors: [`Schéma non trouvé pour '${configKey}'`] };
    }

    const validate = this.validator.compile(this.schemas[configKey]);
    const valid = validate(this.config[configKey]);

    return {
      valid,
      errors: validate.errors
    };
  }

  /**
   * Obtenir une configuration complète
   * @param {string} configKey - Clé de la configuration
   * @returns {Object} Configuration
   */
  getConfig(configKey) {
    if (!this.initialized) {
      throw new Error('Le configurateur n\'est pas initialisé');
    }

    if (!this.config[configKey]) {
      throw new Error(`Configuration '${configKey}' non trouvée`);
    }

    return this.config[configKey];
  }

  /**
   * Obtenir une valeur spécifique dans une configuration
   * @param {string} configKey - Clé de la configuration
   * @param {string} path - Chemin de la valeur (notation par points)
   * @param {*} defaultValue - Valeur par défaut si non trouvée
   * @returns {*} Valeur de la configuration
   */
  getValue(configKey, path, defaultValue = null) {
    if (!this.initialized) {
      throw new Error('Le configurateur n\'est pas initialisé');
    }

    if (!this.config[configKey]) {
      return defaultValue;
    }

    const parts = path.split('.');
    let current = this.config[configKey];

    for (const part of parts) {
      if (current === undefined || current === null || typeof current !== 'object') {
        return defaultValue;
      }
      current = current[part];
    }

    return current !== undefined ? current : defaultValue;
  }

  /**
   * Mettre à jour une valeur dans une configuration
   * @param {string} configKey - Clé de la configuration
   * @param {string} path - Chemin de la valeur (notation par points)
   * @param {*} value - Nouvelle valeur
   * @returns {boolean} Succès de la mise à jour
   */
  setValue(configKey, path, value) {
    if (!this.initialized) {
      throw new Error('Le configurateur n\'est pas initialisé');
    }

    if (!this.config[configKey]) {
      this.config[configKey] = {};
    }

    const parts = path.split('.');
    let current = this.config[configKey];
    
    // Naviguer jusqu'au parent de la propriété cible
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current) || current[part] === null) {
        current[part] = {};
      }
      current = current[part];
    }
    
    // Définir la valeur
    const lastPart = parts[parts.length - 1];
    current[lastPart] = value;
    
    return true;
  }

  /**
   * Enregistrer une configuration dans un fichier
   * @param {string} configKey - Clé de la configuration
   * @returns {Promise<boolean>} Succès de l'enregistrement
   */
  async saveConfig(configKey) {
    if (!this.initialized) {
      throw new Error('Le configurateur n\'est pas initialisé');
    }

    if (!this.config[configKey]) {
      throw new Error(`Configuration '${configKey}' non trouvée`);
    }

    const configPath = CONFIG_PATHS[configKey];
    if (!configPath) {
      throw new Error(`Chemin non défini pour la configuration '${configKey}'`);
    }

    try {
      // Valider si le schéma existe
      if (this.schemas[configKey]) {
        const { valid, errors } = this.validateConfig(configKey);
        if (!valid) {
          console.warn(chalk.yellow(`Validation échouée pour '${configKey}':`, JSON.stringify(errors, null, 2)));
          // Continuer quand même l'enregistrement
        }
      }

      // Écrire le fichier de configuration
      const configData = JSON.stringify(this.config[configKey], null, 2);
      await fs.promises.writeFile(configPath, configData, 'utf8');
      
      console.log(chalk.green(`✓ Configuration '${configKey}' enregistrée: ${configPath}`));
      return true;
    } catch (error) {
      console.error(chalk.red(`Erreur lors de l'enregistrement de '${configKey}': ${error.message}`));
      return false;
    }
  }

  /**
   * Enregistrer toutes les configurations
   * @returns {Promise<boolean>} Succès de l'enregistrement
   */
  async saveAllConfigs() {
    if (!this.initialized) {
      throw new Error('Le configurateur n\'est pas initialisé');
    }

    try {
      for (const configKey of Object.keys(this.config)) {
        await this.saveConfig(configKey);
      }
      return true;
    } catch (error) {
      console.error(chalk.red(`Erreur lors de l'enregistrement des configurations: ${error.message}`));
      return false;
    }
  }

  /**
   * Fusionner une configuration avec une nouvelle
   * @param {string} configKey - Clé de la configuration
   * @param {Object} newConfig - Nouvelle configuration à fusionner
   * @returns {Object} Configuration fusionnée
   */
  mergeConfig(configKey, newConfig) {
    if (!this.initialized) {
      throw new Error('Le configurateur n\'est pas initialisé');
    }

    if (!this.config[configKey]) {
      this.config[configKey] = {};
    }

    // Fusionner les configurations
    this.config[configKey] = deepmerge(this.config[configKey], newConfig);
    
    return this.config[configKey];
  }

  /**
   * Créer une configuration de base si elle n'existe pas
   * @param {string} configKey - Clé de la configuration
   * @param {Object} baseConfig - Configuration de base
   * @returns {boolean} Vrai si créée, faux si existait déjà
   */
  createBaseConfig(configKey, baseConfig) {
    const configPath = CONFIG_PATHS[configKey];
    
    if (!configPath) {
      throw new Error(`Chemin non défini pour la configuration '${configKey}'`);
    }
    
    // Si la configuration existe déjà, ne rien faire
    if (fs.existsSync(configPath)) {
      return false;
    }
    
    // Créer la configuration de base
    this.config[configKey] = baseConfig;
    
    return true;
  }

  /**
   * Réinitialiser une configuration à sa valeur par défaut
   * @param {string} configKey - Clé de la configuration
   * @param {Object} defaultConfig - Configuration par défaut
   * @returns {boolean} Succès de la réinitialisation
   */
  resetConfig(configKey, defaultConfig) {
    if (!this.initialized) {
      throw new Error('Le configurateur n\'est pas initialisé');
    }

    this.config[configKey] = defaultConfig;
    
    return true;
  }

  /**
   * Obtenir la configuration complète
   * @returns {Object} Configuration complète
   */
  getFullConfig() {
    if (!this.initialized) {
      throw new Error('Le configurateur n\'est pas initialisé');
    }

    return this.config;
  }
}

// Exporter une instance unique
const configurator = new BotConfigurator();

module.exports = configurator;