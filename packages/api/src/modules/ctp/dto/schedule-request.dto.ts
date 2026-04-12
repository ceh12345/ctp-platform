import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, ArrayMinSize } from 'class-validator';

export class ScheduleRequestDto {
  @ApiProperty({ type: [String], description: 'Keys of tasks to schedule (1 or more)' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  taskKeys!: string[];
}
