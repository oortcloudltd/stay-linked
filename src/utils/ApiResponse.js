export class ApiResponse {
  constructor(statusCode, data, message = 'Success', meta = null) {
    this.success = true;
    this.statusCode = statusCode;
    this.message = message;
    this.data = data;
    if (meta) this.meta = meta;
  }

  static send(res, statusCode, data, message = 'Success', meta = null) {
    return res.status(statusCode).json(new ApiResponse(statusCode, data, message, meta));
  }

  static ok(res, data, message = 'Success', meta = null) {
    return ApiResponse.send(res, 200, data, message, meta);
  }

  static created(res, data, message = 'Created successfully') {
    return ApiResponse.send(res, 201, data, message);
  }

  static paginated(res, data, pagination, message = 'Success') {
    return res.status(200).json({
      success: true,
      message,
      data,
      pagination,
    });
  }
}
