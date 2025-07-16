import './config/environment.js';
import express, { urlencoded, json } from 'express';
import { ErrorHandler } from './middleware/Error.js';
import { httpLogger } from './middleware/Logger.js';
import cors from 'cors';
import session from 'express-session';
import sequelize from './config/database.js';
import ApiError from './utils/ApiError.js';
import logger from './config/logger.js';
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
import supportRoutes from './routes/client/support.routes.js';

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
// import utsavManagementRoutes from './routes/admin/utsavManagement.routes.js';
import { utsavPublicRouter, utsavAdminRouter } from './routes/admin/utsavManagement.routes.js';
import avtManagementRoutes from './routes/admin/avtManagement.routes.js';
import wifiManagementRoutes from './routes/admin/wifiManagement.routes.js';

// Unified Route Imports
import unifiedBookingRoutes from './routes/client/unifiedBooking.routes.js';

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

(async () => {
  try {
    await sequelize.authenticate();
    logger.info('Connected to Database 🚀');

    // Synchronize the models with the database (create tables if they don't exist)
    await sequelize.sync();
  } catch (error) {
    logger.error('Unable to connect to the database:', error);
  }
})();

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
app.use('/api/v1/support', supportRoutes);

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
// app.use('/api/v1/admin/utsav', utsavManagementRoutes);
app.use('/api/v1/admin/utsav', utsavPublicRouter); // No auth
app.use('/api/v1/admin/utsav', utsavAdminRouter);  // With auth
app.use('/api/v1/admin/avt', avtManagementRoutes);
app.use('/api/v1/admin/wifi', wifiManagementRoutes);

// Unified Routes
app.use('/api/v1/unified', unifiedBookingRoutes);
app.use('/api/v1/guest', guestRoutes);
app.use('/api/v1/mumukshu', mumukshuRoutes);

// if any unknown endpoint is hit then the error is handelled
app.use((_req, _res) => {
  throw new ApiError(404, 'Page Not Found');
});

app.use(ErrorHandler);

const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
  logger.info(`Server is listening on port ${port}...`);
});

// Export the app and a function to close the database connection
export { app, sequelize, server };
