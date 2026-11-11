import { Router } from 'express';
import {
  createMetric,
  getMetrics,
} from '../controllers/metric.controller';

const router = Router();

router.post('/', createMetric);
router.get('/', getMetrics);

export default router;