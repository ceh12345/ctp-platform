import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class HorizonDto {
  @ApiProperty({ example: '2025-06-02T00:00:00', description: 'ISO 8601 start date' })
  @IsString()
  startDate!: string;

  @ApiProperty({ example: '2025-06-09T00:00:00', description: 'ISO 8601 end date' })
  @IsString()
  endDate!: string;
}
