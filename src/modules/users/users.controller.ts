import { Controller, Get, Query } from '@nestjs/common';
import { envelope } from '@app/common/api-response';

@Controller('users')
export class UsersController {
  @Get('search')
  search(@Query('q') query = '') {
    return envelope({
      query,
      users: [],
      message: 'Authenticated user search will be implemented with rate limits.',
    });
  }
}
