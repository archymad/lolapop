#!/usr/bin/env node
require('dotenv').config();

/**
 * Orchestrateur principal pour gérer le démarrage des composants
 * Gère le serveur NLP, l'interface admin et le bot WhatsApp
 */

const { spawn } = require('child_process');
const path = require('path');
const axios = require('axios');
const chalk = require('chalk');
const { getLogger } = require('./utils/logger');

class Orchestrator {
  constructor() {
    // Processus enfants
    this.processes = {
      nlp: null,
      admin: null,
      bot: null
    };

    // Configuration
    this.config = {
      // Ports et URLs
      nlpPort: process.env.FLASK_PORT || 5000,
      adminPort: process.env.ADMIN_PORT || 3000,
      nlpBaseUrl: process.env.NLP_SERVER_URL || `http://${process.env.FLASK_HOST || '127.0.0.1'}:${process.env.FLASK_PORT || 5000}`,
      ollamaBaseUrl: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
      // Commande Python selon OS
      nlpCommand: process.platform === 'win32' ? 'python' : 'python3'
    };

    // Endpoints santé
    this.config.nlpHealthUrl = `${this.config.nlpBaseUrl}/api/health`;
    this.config.ollamaHealthUrl = `${this.config.ollamaBaseUrl}/api/tags`;

    // Logger
    this.logger = getLogger({
      logToFile: true,
      logDir: './logs'
    });

    this.botStatus = 'stopped';
  }

  /**
   * Vérifie que Ollama est en cours d'exécution
   */
  async checkOllama() {
    this.logger.info('🔍 Vérification du serveur Ollama...');
    try {
      await axios.get(this.config.ollamaHealthUrl, { timeout: 5000 });
      this.logger.info('✓ Ollama est en cours d\'exécution');
    } catch (err) {
      this.logger.error('✗ Impossible de joindre Ollama', { message: err.message });
      throw new Error('Ollama n\'est pas démarré ou injoignable');
    }
  }

  /**
   * Vérifie la santé du serveur NLP Flask (endpoint /api/health)
   */
  async checkNLPHealth() {
    this.logger.info('🔍 Vérification du serveur NLP...');
    const maxAttempts = 10;
    for (let i = 1; i <= maxAttempts; i++) {
      try {
        const { data } = await axios.get(this.config.nlpHealthUrl, { timeout: 5000 });
        if (data.status === 'ok') {
          this.logger.info('✓ NLP server is healthy');
          return;
        } else {
          this.logger.warn(`Health check responded with error: ${JSON.stringify(data)}`);
        }
      } catch (err) {
        this.logger.debug(`Tentative ${i}/${maxAttempts} échouée: ${err.message}`);
      }
      await new Promise(res => setTimeout(res, 1000));
    }
    throw new Error('Le serveur NLP n\'est pas disponible après plusieurs tentatives');
  }

  /**
   * Démarre le serveur NLP (Flask)
   */
  async startNLPServer() {
    this.logger.info('🚀 Démarrage du serveur NLP...');
    const script = path.join(__dirname, 'ai', 'model_server.py');
    const env = { ...process.env, FLASK_PORT: this.config.nlpPort };

    const nlpProcess = spawn(this.config.nlpCommand, [script], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env
    });
    this.processes.nlp = nlpProcess;

    // Logger des sorties
    nlpProcess.stdout.on('data', data => {
      this.logger.debug('[NLP Output]', { message: data.toString().trim() });
    });
    nlpProcess.stderr.on('data', data => {
      this.logger.error('[NLP Error]', { message: data.toString().trim() });
    });
    nlpProcess.on('exit', (code, signal) => {
      if (code !== 0) {
        this.logger.error('Le serveur NLP s\'est arrêté de manière inattendue', { code, signal });
      }
    });

    // Vérifier la santé après démarrage
    await this.checkNLPHealth();
  }

  /**
   * Démarre l'interface d'administration (Express)
   */
  async startAdminServer() {
    this.logger.info('🚀 Démarrage de l\'interface d\'administration...');
    return new Promise((resolve, reject) => {
      const adminProcess = spawn('node', ['admin.js'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PORT: this.config.adminPort }
      });
      this.processes.admin = adminProcess;

      adminProcess.stdout.on('data', data => {
        const msg = data.toString().trim();
        this.logger.debug('[Admin Output]', { message: msg });
        if (msg.includes('Interface d\'administration démarrée')) {
          this.logger.info('✓ Interface d\'administration démarrée', {
            url: `http://localhost:${this.config.adminPort}`
          });
          resolve();
        }
      });
      adminProcess.stderr.on('data', data => {
        this.logger.error('[Admin Error]', { message: data.toString().trim() });
      });
      adminProcess.on('error', err => {
        this.logger.error('Erreur démarrage interface admin', { message: err.message });
        reject(err);
      });
      adminProcess.on('exit', (code, signal) => {
        if (code !== 0) {
          this.logger.error('Interface admin arrêtée de manière inattendue', { code, signal });
        }
      });
    });
  }

  /**
   * Ouvre le navigateur vers l'interface admin
   */
  async openBrowser() {
    const url = `http://localhost:${this.config.adminPort}`;
    this.logger.info('🌐 Ouverture du navigateur', { url });
    const opener = process.platform === 'darwin' ? 'open'
                  : process.platform === 'win32' ? 'start'
                  : 'xdg-open';
    require('child_process').exec(`${opener} ${url}`, err => {
      if (err) this.logger.error('Erreur ouverture navigateur', { message: err.message });
      else    this.logger.info('Navigateur ouvert avec succès');
    });
  }

  /**
   * Démarre tous les services (Ollama, NLP, Admin)
   */
  async startServices() {
    try {
      this.logger.info('🚀 Démarrage des services...');
      await this.checkOllama();
      await this.startNLPServer();
      await this.startAdminServer();
      // Pause pour stabilité
      await new Promise(res => setTimeout(res, 2000));
      await this.openBrowser();
      this.logger.info('✨ Services démarrés avec succès!', {
        nlp: this.config.nlpBaseUrl,
        admin: `http://localhost:${this.config.adminPort}`
      });
    } catch (err) {
      this.logger.error('Erreur démarrage services', { message: err.message });
      this.cleanup();
      process.exit(1);
    }
  }

  /**
   * Démarre le bot WhatsApp
   */
  async startBot() {
    this.logger.info('🤖 Démarrage du bot WhatsApp...');
    return new Promise((resolve, reject) => {
      const botProcess = spawn('node', ['bot/index.js'], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
      this.processes.bot = botProcess;
      botProcess.stdout.on('data', data => {
        const msg = data.toString().trim();
        this.logger.debug('[Bot Output]', { message: msg });
        if (msg.includes('Client WhatsApp prêt')) {
          this.logger.info('✓ Bot WhatsApp démarré');
          resolve();
        } else if (msg.includes('QR Code')) {
          this.logger.info('QR Code généré - scannez');
        }
      });
      botProcess.stderr.on('data', data => this.logger.error('[Bot Error]', { message: data.toString().trim() }));
      botProcess.on('error', err => {
        this.logger.error('Erreur démarrage bot', { message: err.message });
        reject(err);
      });
      botProcess.on('exit', (code, signal) => {
        this.botStatus = 'stopped';
        if (code !== 0) {
          this.logger.error('Bot arrêté de façon inattendue', { code, signal });
        } else {
          this.logger.info('Bot arrêté normalement');
        }
      });
    });
  }

  /**
   * Stoppe tous les processus enfants
   */
  cleanup() {
    this.logger.info('🧹 Nettoyage des processus...');
    Object.entries(this.processes).forEach(([name, proc]) => {
      if (proc) {
        this.logger.info(`Arrêt de ${name}...`);
        try { proc.kill('SIGINT'); }
        catch (err) { this.logger.error(`Erreur arrêt ${name}`, { message: err.message }); }
      }
    });
  }

  /**
   * Configure la gestion des signaux externes
   */
  setupSignalHandlers() {
    ['SIGINT','SIGTERM'].forEach(sig => {
      process.on(sig, () => {
        this.logger.info(`✋ ${sig} reçu - arrêt`);
        this.cleanup();
        process.exit(0);
      });
    });
    process.on('uncaughtException', err => {
      this.logger.error('Exception non gérée', { message: err.message, stack: err.stack });
      this.cleanup();
      process.exit(1);
    });
    process.on('unhandledRejection', (reason) => {
      this.logger.error('Promesse rejetée non gérée', { reason });
    });
  }

  /**
   * Renvoie les statistiques du système et des processus
   */
  getSystemStats() {
    const stats = { uptime: process.uptime(), memory: process.memoryUsage(), processes: {} };
    Object.entries(this.processes).forEach(([name, proc]) => {
      stats.processes[name] = { running: !!proc, pid: proc ? proc.pid : null };
    });
    return stats;
  }
}

// Fonction principale
async function main() {
  console.log(chalk.cyan('╔════════════════════════════════════════╗'));
  console.log(chalk.cyan('║        Bot Conversationnel - Lola      ║'));
  console.log(chalk.cyan('╚════════════════════════════════════════╝'));
  console.log();

  const orchestrator = new Orchestrator();
  orchestrator.setupSignalHandlers();
  orchestrator.logger.info('Démarrage du système de bot conversationnel', {
    platform: process.platform,
    nodeVersion: process.version,
    environment: process.env.NODE_ENV || 'development'
  });

  // Démarrer les services puis le bot
  await orchestrator.startServices();
  await orchestrator.startBot();

  // Statistiques périodiques
  setInterval(() => {
    orchestrator.logger.debug('Statistiques système', orchestrator.getSystemStats());
  }, 60000);
}

if (require.main === module) {
  main().catch(err => {
    console.error(chalk.red('Erreur fatale:'), err);
    process.exit(1);
  });
}

module.exports = Orchestrator;
