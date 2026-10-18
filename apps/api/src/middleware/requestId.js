import { randomUUID } from 'node:crypto';
/** Every request gets an id (echoed in the response) so a bug report can be traced in logs. */
export const requestId = (req, res, next) => {
  const incoming = req.header('x-request-id');
  const id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  req.id = id;
  res.setHeader('x-request-id', id);
  next();
};
