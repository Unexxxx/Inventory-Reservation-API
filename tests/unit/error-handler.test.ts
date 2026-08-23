import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/errors/app-error.js';
import { errorHandler } from '../../src/middleware/error-handler.js';

describe('error handler', () => {
  it('formats expected errors consistently', async () => {
    const app = express();
    app.get('/', () => { throw new AppError(409, 'CONFLICT', 'Conflict.', { field: 'value' }); });
    app.use(errorHandler);
    const response = await request(app).get('/');
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: { code: 'CONFLICT', message: 'Conflict.', details: { field: 'value' } } });
  });

  it('sanitizes unknown errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = express();
    app.get('/', () => { throw new Error('password=secret SQL failed'); });
    app.use(errorHandler);
    const response = await request(app).get('/');
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('secret');
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
  });
});
