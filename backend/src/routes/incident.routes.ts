
import { Router } from 'express';
import {
  getIncidents,
  getIncidentById,
  updateIncidentStatus,
} from '../controllers/incident.controller';

const router = Router();

router.get('/', getIncidents);
router.get('/:id', getIncidentById);
router.patch('/:id/status', updateIncidentStatus);

export default router;
