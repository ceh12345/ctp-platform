import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, ArrayMinSize } from 'class-validator';

export class UnscheduleRequestDto {
  @ApiProperty({ type: [String], description: 'Keys of tasks to unschedule (1 or more)' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  taskKeys!: string[];
}
