import './config/environment.js';

import express, { urlencoded, json } from 'express';
import { ErrorHandler } from './middleware/Error.js';
import { httpLogger } from './middleware/Logger.js';
import cors from 'cors';
import session from 'express-session';
import sequelize from './config/database.js';
import ApiError from './utils/ApiError.js';
import logger from './config/logger.js';
import connectionMonitor from './utils/connectionMonitor.js';
import fs from 'fs';
import path from 'path';

import wifiRoutes from './routes/wifi/wifi.routes.js';

// Client Route Imports
import clientAuthRoutes from './routes/client/auth.routes.js';
import roomRoutes from './routes/client/roomBooking.routes.js';
import foodRoutes from './routes/client/foodBooking.routes.js';
import travelRoutes from './routes/client/travelBooking.routes.js';
import adhyayanRoutes from './routes/client/adhyayanBooking.routes.js';
import utsavBookingRoutes from './routes/client/utsavBooking.routes.js';
import maintenanceRoutes from './routes/client/maintenaneRequest.routes.js';
import profileRoutes from './routes/client/profile.routes.js';
import locationRoutes from './routes/client/location.routes.js';
import guestRoutes from './routes/client/guestBooking.routes.js';
import mumukshuRoutes from './routes/client/mumukshuBooking.routes.js';
import paymentRoutes from './routes/client/payment.routes.js';
import updateRoutes from './routes/client/updates.routes.js';
import ticketRoutes from './routes/client/ticket.routes.js';

// Admin Route Imports
import authRoutes from './routes/admin/auth.routes.js';
import adminControlRoutes from './routes/admin/adminControls.routes.js';
import adhyayanManagementRoutes from './routes/admin/adhyayanManagement.routes.js';
import cardManagementRoutes from './routes/admin/cardManagement.routes.js';
import foodManagementRoutes from './routes/admin/foodManagement.routes.js';
import gateManagementRoutes from './routes/admin/gateManagement.routes.js';
import roomManagementRoutes from './routes/admin/roomManagement.routes.js';
import travelManagementRoutes from './routes/admin/travelManagement.routes.js';
import accountsManagementRoutes from './routes/admin/accountsManagement.routes.js';
import maintenanceManagementRoutes from './routes/admin/maintenanceManagement.routes.js';
import bookingManagementRoutes from './routes/admin/bookingManagement.routes.js';
import shortLinkRoutes from './routes/admin/shortLink.routes.js';
import redirectRoutes from './routes/admin/redirect.routes.js';
// import utsavManagementRoutes from './routes/admin/utsavManagement.routes.js';
import {
  utsavPublicRouter,
  utsavAdminRouter
} from './routes/admin/utsavManagement.routes.js';
import avtManagementRoutes from './routes/admin/avtManagement.routes.js';
import wifiManagementRoutes from './routes/admin/wifiManagement.routes.js';
import coordinatorAuthRoutes from './routes/admin/coordinatorAuth.routes.js';
import ticketManagementRoutes from './routes/admin/ticketManagement.routes.js';

// Unified Route Imports
import unifiedBookingRoutes from './routes/client/unifiedBooking.routes.js';

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

if (process.env.NODE_ENV != 'test') {
  (async () => {
    try {
      await sequelize.authenticate();
      logger.info('Connected to Database 🚀');

      // Synchronize the models with the database (create tables if they don't exist)
      await sequelize.sync();

      // Pre-warm the connection pool to minimum size
      const minConnections = sequelize.options.pool.min || 2;
      const warmupPromises = Array.from({ length: minConnections }, () =>
        sequelize.query('SELECT 1 as warmup', {
          type: sequelize.QueryTypes.SELECT
        })
      );
      await Promise.all(warmupPromises);
      logger.info(
        `Connection pool warmed up with ${minConnections} connections`
      );

      // Start connection monitoring
      connectionMonitor.start();
    } catch (error) {
      logger.error('Unable to connect to the database:', error);
    }
  })();
}

const corsOptions = {
  // origin: [
  //   'https://aashray.vitraagvigyaan.org',
  //   'https://aashray-admin-lp7f.onrender.com',
  //   'http://localhost:5500'
  // ],
  origin: '*',
  credentials: true,
  optionSuccessStatus: 200
};

const app = express();
app.use(urlencoded({ extended: true }));
app.use(json());
app.use(cors(corsOptions));
app.use(httpLogger);

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false, maxAge: 86400000 }
  })
);

app.get('/api', (_req, res) => {
  res.status(200).send({ data: 'API is up and running... 🚀', status: 200 });
});

// Health check endpoint with database connection test
app.get('/api/health', async (_req, res) => {
  try {
    // Test database connection
    await sequelize.authenticate();

    // Get connection pool status
    const pool = sequelize.connectionManager.pool;
    const poolStatus = {
      size: pool.size,
      available: pool.available,
      using: pool.using,
      waiting: pool.waiting
    };

    // Get pool configuration for comparison
    const poolConfig = sequelize.options.pool;

    res.status(200).send({
      status: 'healthy',
      database: 'connected',
      environment: process.env.NODE_ENV || 'dev',
      pool: {
        current: poolStatus,
        configured: poolConfig
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).send({
      status: 'unhealthy',
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});


app.use('/api/v1/updates', updateRoutes);

app.use('/api/v1/client', clientAuthRoutes);
app.use('/api/v1/wifi', wifiRoutes);
app.use('/api/v1/stay', roomRoutes);
app.use('/api/v1/food', foodRoutes);
app.use('/api/v1/travel', travelRoutes);
app.use('/api/v1/adhyayan', adhyayanRoutes);
app.use('/api/v1/utsav', utsavBookingRoutes);
app.use('/api/v1/maintenance', maintenanceRoutes);
app.use('/api/v1/profile', profileRoutes);
app.use('/api/v1/location', locationRoutes);
app.use('/api/v1/razorpay', paymentRoutes);
app.use('/api/v1/tickets', ticketRoutes);

// Admin Routes
app.use('/api/v1/admin/sudo', adminControlRoutes);
app.use('/api/v1/admin/auth', authRoutes);
app.use('/api/v1/admin/adhyayan', adhyayanManagementRoutes);
app.use('/api/v1/admin/card', cardManagementRoutes);
app.use('/api/v1/admin/food', foodManagementRoutes);
app.use('/api/v1/admin/gate', gateManagementRoutes);
app.use('/api/v1/admin/stay', roomManagementRoutes);
app.use('/api/v1/admin/travel', travelManagementRoutes);
app.use('/api/v1/admin/accounts', accountsManagementRoutes);
app.use('/api/v1/admin/maintenance', maintenanceManagementRoutes);
app.use('/api/v1/admin/bookings', bookingManagementRoutes);
app.use('/api/v1/admin/location', locationRoutes);
app.use('/api/v1/admin/utsav', utsavPublicRouter); // No auth
app.use('/api/v1/admin/utsav', utsavAdminRouter); // With auth
app.use('/api/v1/admin/avt', avtManagementRoutes);
app.use('/api/v1/admin/wifi', wifiManagementRoutes);
app.use('/api/v1/coordinator', coordinatorAuthRoutes);
app.use('/api/v1/admin/tickets', ticketManagementRoutes);
app.use('/api/v1/short-links', shortLinkRoutes);
app.use('/', redirectRoutes);

// Unified Routes
app.use('/api/v1/unified', unifiedBookingRoutes);
app.use('/api/v1/guest', guestRoutes);
app.use('/api/v1/mumukshu', mumukshuRoutes);

// if any unknown endpoint is hit then the error is handelled
app.use((_req, _res) => {
  throw new ApiError(404, 'Page Not Found');
});

app.use(ErrorHandler);

if (process.env.NODE_ENV != 'test') {
  const port = process.env.PORT || 3000;
  const server = app.listen(port, () => {
    logger.info(`Server is listening on port ${port}...`);
  });

  // Graceful shutdown handling
  const gracefulShutdown = async (signal) => {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);

    // Close HTTP server first
    server.close(async () => {
      logger.info('HTTP server closed');

      try {
        // Stop connection monitoring
        connectionMonitor.stop();

        // Close database connections
        await sequelize.close();
        logger.info('Database connections closed');
        process.exit(0);
      } catch (error) {
        logger.error('Error during graceful shutdown:', error);
        process.exit(1);
      }
    });

    // Force shutdown after 30 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
  };

  // Handle shutdown signals
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    gracefulShutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown('unhandledRejection');
  });
}

// Export the app and a function to close the database connection
export { app, sequelize };
