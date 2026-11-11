import { Router } from 'express';
import {
  getServices,
  getServiceByName,
} from '../controllers/service.controller';

const router = Router();

router.get('/', getServices);
router.get('/:name', getServiceByName);

export default router;