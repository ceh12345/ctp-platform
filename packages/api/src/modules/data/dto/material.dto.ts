import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MaterialDto {
  @ApiProperty({ description: 'Material key' })
  key!: string;

  @ApiProperty({ description: 'Material name' })
  name!: string;

  @ApiProperty({ description: 'Unit of measure' })
  unit!: string;

  @ApiProperty({ description: 'On-hand inventory quantity' })
  onHand!: number;

  @ApiPropertyOptional({ description: 'Incoming replenishment quantity' })
  incoming?: number;

  @ApiPropertyOptional({ description: 'Incoming date (ISO 8601)' })
  incomingDate?: string | null;
}
