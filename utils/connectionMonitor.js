import logger from '../config/logger.js';
import sequelize from '../config/database.js';

/**
 * Monitor database connection pool status
 */
export class ConnectionMonitor {
  constructor(intervalMs = 60000) {
    // Default: check every minute
    this.intervalMs = intervalMs;
    this.monitoringInterval = null;
    this.isMonitoring = false;
  }

  start() {
    if (this.isMonitoring) {
      logger.warn('Connection monitor is already running');
      return;
    }

    this.isMonitoring = true;
    logger.info('Starting connection pool monitoring');

    this.monitoringInterval = setInterval(() => {
      this.checkConnectionPool();
    }, this.intervalMs);

    // Initial check
    this.checkConnectionPool();
  }

  stop() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    this.isMonitoring = false;
    logger.info('Connection pool monitoring stopped');
  }

  checkConnectionPool() {
    try {
      const pool = sequelize.connectionManager.pool;

      const status = {
        size: pool.size,
        available: pool.available,
        using: pool.using,
        waiting: pool.waiting,
        max_uses_per_resource: pool.maxUsesPerResource,
        timestamp: new Date().toISOString()
      };

      // Log warnings for potential issues
      if (status.waiting > 0) {
        logger.warn(
          `Connection pool has ${
            status.waiting
          } waiting connections - ${JSON.stringify(status)}`
        );
      }

      if (status.size > 0 && status.using / status.size > 0.8) {
        logger.warn(
          `Connection pool usage is high: ${status.using}/${
            status.size
          } - ${JSON.stringify(status)}`
        );
      }

      if (status.available === 0 && status.using === status.size) {
        logger.error(`Connection pool exhausted! - ${JSON.stringify(status)}`);
      }

      // Log info every 10 minutes
      if (Date.now() % 600000 < this.intervalMs) {
        logger.info(`Connection pool status: ${JSON.stringify(status)}`);
      }
    } catch (error) {
      logger.error(`Failed to check connection pool status: ${error.message}`);
    }
  }

  async testConnection() {
    try {
      await sequelize.authenticate();
      logger.info('Database connection test successful');
      return true;
    } catch (error) {
      logger.error(`Database connection test failed: ${error.message}`);
      return false;
    }
  }
}

// Create singleton instance
const connectionMonitor = new ConnectionMonitor();

export default connectionMonitor;
