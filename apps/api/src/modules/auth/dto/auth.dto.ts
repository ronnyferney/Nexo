import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(128) password!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(80) workspaceName?: string;
}

export class LoginDto {
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty() @IsString() password!: string;
}

export class SwitchWorkspaceDto {
  @ApiProperty() @IsString() workspaceId!: string;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() currentPassword!: string;
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(128) newPassword!: string;
}

export class ForgotPasswordDto {
  @ApiProperty() @IsEmail() email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token del enlace recibido por correo' })
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  token!: string;

  @ApiProperty() @IsString() @MinLength(8) @MaxLength(128) password!: string;
}
