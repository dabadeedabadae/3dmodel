import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { FeedbackDto, RecommendDto, SaveOutfitDto } from './dto';
import { RecommendationsService } from './recommendations.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  /** Outfits from the user's own wardrobe for an event (its forecast) or an occasion (current weather). */
  @Post('recommendations')
  @HttpCode(200)
  recommend(@CurrentUser() user: AuthenticatedUser, @Body() dto: RecommendDto) {
    return this.recommendations.recommend(user.id, dto);
  }

  /** "Fits" / "doesn't fit" on a recommended outfit; `verdict: null` removes it. */
  @Put('recommendations/feedback')
  feedback(@CurrentUser() user: AuthenticatedUser, @Body() dto: FeedbackDto) {
    return this.recommendations.feedback(user.id, dto);
  }

  @Get('outfits')
  outfits(@CurrentUser() user: AuthenticatedUser) {
    return this.recommendations.listOutfits(user.id);
  }

  @Post('outfits')
  save(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveOutfitDto) {
    return this.recommendations.saveOutfit(user.id, dto);
  }

  @Delete('outfits/:id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.recommendations.deleteOutfit(user.id, id);
  }
}
