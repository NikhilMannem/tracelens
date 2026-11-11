import { Router } from 'express';
import {
  validateLog,
  createLog,
  getLogs,
} from '../controllers/log.controller';

const router = Router();

router.post('/validate', validateLog);
router.post('/', createLog);
router.get('/', getLogs);

export default router;