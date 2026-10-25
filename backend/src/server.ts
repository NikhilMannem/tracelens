import 'dotenv/config';
import app from './app';
import { startIncidentDetector } from './services/incidentDetector';

const stopIncidentDetector = startIncidentDetector(15_000);
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>{
    console.log(`Server is running on port ${PORT}`);
})

process.once('SIGINT', () => {
  stopIncidentDetector();
  process.exit(0);
});

process.once('SIGTERM', () => {
  stopIncidentDetector();
  process.exit(0);
});