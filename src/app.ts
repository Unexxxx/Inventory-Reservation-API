import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from './docs/openapi.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { apiRouter } from './routes/index.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.get('/openapi.json', (_request, response) => response.json(openApiDocument));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
app.use(apiRouter);
app.use(notFound);
app.use(errorHandler);

export default app;
