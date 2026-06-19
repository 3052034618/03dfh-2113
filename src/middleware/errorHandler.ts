import { Request, Response, NextFunction } from 'express';

export function notFoundHandler(req: Request, res: Response, next: NextFunction) {
  res.status(404).json({
    success: false,
    error: '接口不存在',
    path: req.path
  });
}

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  console.error('[Error]', err);
  res.status(500).json({
    success: false,
    error: '服务器内部错误',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
}
