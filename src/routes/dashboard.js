import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getSslDashboard, getUptimeDashboard } from '../services/dashboard.js';

export const dashboardRouter = express.Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get('/uptime', async (req, res) => {
  res.json(await getUptimeDashboard());
});

dashboardRouter.get('/ssl', async (req, res) => {
  res.json(await getSslDashboard());
});
