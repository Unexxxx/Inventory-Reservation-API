import type { NextFunction, Request, Response } from 'express';
import * as reservationsService from '../services/reservations.service.js';

export async function createReservation(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const result = await reservationsService.createReservation(
      request.body,
      request.headers['idempotency-key'] as string | undefined
    );
    response.status(result.replayed ? 200 : 201).json(result.reservation);
  } catch (error) { next(error); }
}

export async function confirmReservation(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    response.status(200).json(await reservationsService.confirmReservation(request.params.reservationId as string));
  } catch (error) { next(error); }
}

export async function cancelReservation(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    response.status(200).json(await reservationsService.cancelReservation(request.params.reservationId as string));
  } catch (error) { next(error); }
}

export async function expireReservations(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    response.status(200).json(await reservationsService.expireReservations(request.body.limit as number));
  } catch (error) { next(error); }
}
