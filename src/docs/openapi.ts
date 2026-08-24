const errorSchema = {
  type: 'object', additionalProperties: false, required: ['error'],
  properties: { error: { type: 'object', additionalProperties: false, required: ['code', 'message'], properties: {
    code: { type: 'string' }, message: { type: 'string' }, details: { type: 'object', additionalProperties: true }
  } } }
};

const jsonContent = (schema: unknown) => ({ content: { 'application/json': { schema } } });
const reference = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const responseReference = (name: string) => ({ $ref: `#/components/responses/${name}` });

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Inventory Reservation API',
    version: '1.0.0',
    description: 'Atomic, retry-safe single-item inventory reservations.'
  },
  servers: [{ url: '/', description: 'Current server' }],
  tags: [{ name: 'Items' }, { name: 'Reservations' }, { name: 'Documentation' }],
  paths: {
    '/v1/items': { post: {
      tags: ['Items'], operationId: 'createItem', summary: 'Create an item with its initial quantity',
      requestBody: { required: true, ...jsonContent(reference('CreateItemRequest')) },
      responses: {
        '201': { description: 'Item created', ...jsonContent(reference('ItemInventory')) },
        '400': responseReference('ValidationError'), '500': responseReference('InternalError')
      }
    } },
    '/v1/items/{itemId}': { get: {
      tags: ['Items'], operationId: 'getItemInventory', summary: 'Get current inventory status',
      parameters: [{ $ref: '#/components/parameters/ItemId' }],
      responses: {
        '200': { description: 'Current inventory at database time', ...jsonContent(reference('ItemInventory')) },
        '400': responseReference('ValidationError'), '404': responseReference('NotFoundError'),
        '500': responseReference('InternalError')
      }
    } },
    '/v1/reservations': { post: {
      tags: ['Reservations'], operationId: 'createReservation', summary: 'Create a temporary reservation atomically',
      parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
      requestBody: { required: true, ...jsonContent(reference('CreateReservationRequest')) },
      responses: {
        '201': { description: 'New reservation created', ...jsonContent(reference('Reservation')) },
        '200': { description: 'Identical retry returned the original reservation', ...jsonContent(reference('Reservation')) },
        '400': responseReference('ValidationError'), '404': responseReference('NotFoundError'),
        '409': { description: 'Insufficient inventory or idempotency conflict', ...jsonContent(reference('ErrorResponse')) },
        '500': responseReference('InternalError')
      }
    } },
    '/v1/reservations/{reservationId}/confirm': { post: {
      tags: ['Reservations'], operationId: 'confirmReservation', summary: 'Confirm a pending unexpired reservation',
      parameters: [{ $ref: '#/components/parameters/ReservationId' }],
      responses: {
        '200': { description: 'Confirmed reservation or idempotent replay', ...jsonContent(reference('Reservation')) },
        '400': responseReference('ValidationError'), '404': responseReference('NotFoundError'),
        '409': { description: 'Expired or incompatible reservation', ...jsonContent(reference('ErrorResponse')) },
        '500': responseReference('InternalError')
      }
    } },
    '/v1/reservations/{reservationId}/cancel': { post: {
      tags: ['Reservations'], operationId: 'cancelReservation', summary: 'Cancel a pending reservation',
      parameters: [{ $ref: '#/components/parameters/ReservationId' }],
      responses: {
        '200': { description: 'Cancelled reservation or idempotent replay', ...jsonContent(reference('Reservation')) },
        '400': responseReference('ValidationError'), '404': responseReference('NotFoundError'),
        '409': { description: 'Incompatible reservation state', ...jsonContent(reference('ErrorResponse')) },
        '500': responseReference('InternalError')
      }
    } },
    '/v1/maintenance/expire-reservations': { post: {
      tags: ['Reservations'], operationId: 'expireReservations', summary: 'Expire one bounded batch of overdue reservations',
      requestBody: { required: false, ...jsonContent(reference('ExpireReservationsRequest')) },
      responses: {
        '200': { description: 'Expiration pass completed', ...jsonContent(reference('ExpirationResult')) },
        '400': responseReference('ValidationError'), '500': responseReference('InternalError')
      }
    } },
    '/openapi.json': { get: {
      tags: ['Documentation'], operationId: 'getOpenApiDocument', summary: 'Get the OpenAPI document',
      responses: { '200': { description: 'OpenAPI JSON', ...jsonContent({ type: 'object', additionalProperties: true }) } }
    } },
    '/docs': { get: {
      tags: ['Documentation'], operationId: 'getSwaggerUi', summary: 'Open interactive Swagger UI',
      responses: { '200': { description: 'Swagger UI HTML', content: { 'text/html': { schema: { type: 'string' } } } } }
    } }
  },
  components: {
    parameters: {
      ItemId: { name: 'itemId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ReservationId: { name: 'reservationId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      IdempotencyKey: { name: 'Idempotency-Key', in: 'header', required: false, description: 'Optional retry key for one logical creation request. The server generates one when omitted.', schema: { type: 'string', minLength: 1, maxLength: 255 } }
    },
    schemas: {
      CreateItemRequest: { type: 'object', additionalProperties: false, required: ['name', 'initial_quantity'], properties: {
        name: { type: 'string', minLength: 1, maxLength: 255 },
        initial_quantity: { type: 'integer', format: 'int64', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }
      } },
      ItemInventory: { type: 'object', additionalProperties: false, required: ['id', 'name', 'totalQuantity', 'availableQuantity', 'heldQuantity', 'confirmedQuantity', 'createdAt'], properties: {
        id: { type: 'string', format: 'uuid' }, name: { type: 'string', minLength: 1, maxLength: 255 }, totalQuantity: { type: 'integer', minimum: 1 },
        availableQuantity: { type: 'integer', minimum: 0 }, heldQuantity: { type: 'integer', minimum: 0 },
        confirmedQuantity: { type: 'integer', minimum: 0 }, createdAt: { type: 'string', format: 'date-time' }
      } },
      CreateReservationRequest: { type: 'object', additionalProperties: false, required: ['item_id', 'customer_id', 'quantity'], properties: {
        item_id: { type: 'string', format: 'uuid' }, customer_id: { type: 'string', minLength: 1, maxLength: 255 },
        quantity: { type: 'integer', format: 'int64', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
        expires_at: { type: 'string', format: 'date-time', description: 'Must be later than server time; defaults to the configured TTL.' }
      } },
      ReservationStatus: { type: 'string', enum: ['pending', 'confirmed', 'cancelled', 'expired'] },
      Reservation: { type: 'object', additionalProperties: false, required: ['id', 'itemId', 'customerId', 'quantity', 'status', 'createdAt', 'expiresAt'], properties: {
        id: { type: 'string', format: 'uuid' }, itemId: { type: 'string', format: 'uuid' },
        customerId: { type: 'string', minLength: 1, maxLength: 255 }, quantity: { type: 'integer', minimum: 1 },
        status: reference('ReservationStatus'), createdAt: { type: 'string', format: 'date-time' },
        expiresAt: { type: 'string', format: 'date-time' }
      } },
      ExpireReservationsRequest: { type: 'object', additionalProperties: false, properties: {
        limit: { type: 'integer', minimum: 1, maximum: 1000, default: 500 }
      } },
      ExpirationResult: { type: 'object', additionalProperties: false, required: ['expiredCount', 'hasMore'], properties: {
        expiredCount: { type: 'integer', minimum: 0 }, hasMore: { type: 'boolean' }
      } },
      ErrorResponse: errorSchema
    },
    responses: {
      ValidationError: { description: 'Request validation failed', ...jsonContent(reference('ErrorResponse')) },
      NotFoundError: { description: 'Requested resource does not exist', ...jsonContent(reference('ErrorResponse')) },
      InternalError: { description: 'Unexpected server or database failure', ...jsonContent(reference('ErrorResponse')) }
    }
  }
} as const;
