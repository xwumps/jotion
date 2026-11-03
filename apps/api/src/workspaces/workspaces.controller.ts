import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  createInvitationSchema,
  createWorkspaceSchema,
  updateMemberSchema,
  updateWorkspaceSchema,
} from '@jotion/shared';
import { CurrentUser, type AuthUser } from '../common/request-context';
import { UUID } from '../common/uuid.pipe';
import { parse } from '../common/validation';
import { WorkspacesService } from './workspaces.service';

@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.workspaces.create(user, parse(createWorkspaceSchema, body));
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', UUID) id: string) {
    return this.workspaces.get(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', UUID) id: string, @Body() body: unknown) {
    return this.workspaces.update(user, id, parse(updateWorkspaceSchema, body));
  }

  @Get(':id/members')
  members(@CurrentUser() user: AuthUser, @Param('id', UUID) id: string) {
    return this.workspaces.members(user, id);
  }

  @Patch(':id/members/:userId')
  @HttpCode(204)
  updateMember(
    @CurrentUser() user: AuthUser,
    @Param('id', UUID) id: string,
    @Param('userId', UUID) userId: string,
    @Body() body: unknown,
  ) {
    return this.workspaces.updateMember(user, id, userId, parse(updateMemberSchema, body));
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id', UUID) id: string,
    @Param('userId', UUID) userId: string,
  ) {
    return this.workspaces.removeMember(user, id, userId);
  }

  @Post(':id/members/:userId/reset-link')
  resetLink(
    @CurrentUser() user: AuthUser,
    @Param('id', UUID) id: string,
    @Param('userId', UUID) userId: string,
  ) {
    return this.workspaces.createResetLink(user, id, userId);
  }

  @Get(':id/invitations')
  invitations(@CurrentUser() user: AuthUser, @Param('id', UUID) id: string) {
    return this.workspaces.invitations(user, id);
  }

  @Post(':id/invitations')
  createInvitation(
    @CurrentUser() user: AuthUser,
    @Param('id', UUID) id: string,
    @Body() body: unknown,
  ) {
    return this.workspaces.createInvitation(user, id, parse(createInvitationSchema, body));
  }

  @Delete(':id/invitations/:invitationId')
  @HttpCode(204)
  revokeInvitation(
    @CurrentUser() user: AuthUser,
    @Param('id', UUID) id: string,
    @Param('invitationId', UUID) invitationId: string,
  ) {
    return this.workspaces.revokeInvitation(user, id, invitationId);
  }
}
