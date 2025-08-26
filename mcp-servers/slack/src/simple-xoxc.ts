/**
 * Slack XOXC/XOXD Session-Based Authentication Helper
 * 
 * CRITICAL SECURITY NOTE: This module handles session-based authentication using
 * XOXC (session cookie) and XOXD (session secret) tokens extracted from browser sessions.
 * 
 * AUTHENTICATION METHOD:
 * - XOXC Token: Primary bearer token (format: xoxc-...) acts as session identifier
 * - XOXD Token: Secondary cookie parameter (format: xoxd-...) validates session
 * - Combined: Provides full user-level access without bot installation
 * 
 * SECURITY IMPLICATIONS:
 * ⚠️  These tokens are equivalent to user credentials - PROTECT THEM CAREFULLY
 * ⚠️  Tokens expire when user logs out or session times out
 * ⚠️  All actions appear as performed by the token owner (no service account identity)
 * ⚠️  Full workspace access - can read/write anything the user can access
 * 
 * TOKEN EXTRACTION:
 * 1. Login to Slack web interface
 * 2. Open Developer Tools → Application → Cookies → https://app.slack.com
 * 3. Find 'd' cookie value = XOXD token
 * 4. Network tab → Find API request → Authorization header = XOXC token
 * 
 * ROTATION POLICY:
 * - Tokens should be rotated regularly (weekly/monthly)
 * - Extract new tokens when authentication errors occur
 * - Monitor for unexpected session termination
 * 
 * WHY NOT BOT TOKENS:
 * - Bot tokens require app installation and approval
 * - Limited scope and channel access
 * - Complex OAuth flow setup
 * - Session tokens provide immediate full access for internal tools
 */

import { WebClient } from '@slack/web-api';

/**
 * Creates a Slack WebClient using XOXC/XOXD session authentication
 * 
 * @param xoxcToken - Primary session token (xoxc-...) from Authorization header
 * @param xoxdToken - Secondary session secret (xoxd-...) from 'd' cookie
 * @returns Configured WebClient with session authentication
 * 
 * @example
 * ```typescript
 * const client = createXOXCWebClient(
 *   'xoxc-1234567890-1234567890-1234567890-abcdef',
 *   'xoxd-1234567890'
 * );
 * ```
 */
export function createXOXCWebClient(xoxcToken: string, xoxdToken?: string): WebClient {
  return new WebClient(xoxcToken, {
    headers: {
      // The 'd' cookie parameter is required for session validation
      // Format: d=<xoxd_token>; d-s= (d-s is always empty but required)
      'Cookie': xoxdToken ? `d=${encodeURIComponent(xoxdToken)}; d-s=` : '',
    },
  });
}