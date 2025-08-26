# Security Documentation - Slack MCP Server

## Authentication Security Model

### Overview

This Slack MCP server implements a **session-based authentication** approach using XOXC/XOXD tokens instead of traditional OAuth bot tokens. This design choice prioritizes **immediate functionality** and **full workspace access** for internal release management tools.

## Authentication Methods Compared

| Aspect | XOXC/XOXD Session | Bot Token OAuth |
|--------|------------------|-----------------|
| **Installation** | None required | App installation + approval |
| **Permissions** | Full user permissions | Limited to granted scopes |
| **Channel Access** | All user-accessible channels | Only channels bot is invited to |
| **Setup Time** | 5 minutes | Hours/days (approval process) |
| **Audit Trail** | Actions appear as user | Actions appear as bot |
| **Token Lifetime** | Session-based (days/weeks) | Long-lived (until revoked) |
| **Security Risk** | High (user credentials) | Medium (limited scope) |

## Token Security Details

### XOXC Token (Session Bearer)
- **Format**: `xoxc-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`
- **Purpose**: Primary authentication token representing active user session
- **Extraction**: Found in `Authorization: Bearer` headers in browser developer tools
- **Lifetime**: Expires when user logs out or session times out (typically 7-30 days)
- **Risk Level**: 🔴 **CRITICAL** - Equivalent to user password

### XOXD Token (Session Validation)
- **Format**: `xoxd-XXXXXXXXXXXXXXXXXXXXXXX`
- **Purpose**: Session validation parameter sent as cookie
- **Extraction**: Found as `d` cookie value in browser Application tab
- **Lifetime**: Tied to XOXC session
- **Risk Level**: 🟡 **HIGH** - Required for session validation

## Threat Model

### Risks We Accept
1. **Credential Exposure**: Tokens in environment variables or logs
2. **Session Hijacking**: Stolen tokens provide full user access
3. **No Service Identity**: Actions attributed to human user, not service
4. **Manual Rotation**: Tokens must be manually refreshed when expired

### Risks We Mitigate
1. **Unauthorized Channels**: Write access restricted to `qa-release-status` only
2. **Accidental Posts**: Business logic prevents posting to wrong channels
3. **Token Leakage**: Tokens stored in environment variables, not code
4. **Workspace Isolation**: Tokens only work for specific workspace

### Attack Scenarios

#### High Risk: Token Theft
- **Attack**: Malicious actor gains access to XOXC/XOXD tokens
- **Impact**: Full read/write access to workspace as the user
- **Mitigation**: 
  - Store tokens securely
  - Rotate tokens regularly
  - Monitor unusual API activity
  - Implement channel write restrictions

#### Medium Risk: Session Expiration
- **Attack**: Tokens expire during critical release window
- **Impact**: Release process blocked until new tokens extracted
- **Mitigation**: 
  - Monitor token health
  - Have backup authentication ready
  - Document token refresh process

#### Low Risk: Over-Privileged Access
- **Attack**: Service performs unintended actions
- **Impact**: Accidental posts or data access
- **Mitigation**: 
  - Strict channel write controls
  - Code review for all tool implementations
  - Testing in isolated environments

## Security Controls Implemented

### 1. Channel Write Restrictions
```typescript
// BUSINESS REQUIREMENT: Only allow posting to qa-release-status channel
const allowedChannels = ['qa-release-status', '#qa-release-status', 'C09BW9Y2HSN'];
```

**Purpose**: Prevent accidental or malicious posts to unauthorized channels

### 2. Environment Variable Protection
```bash
# Never commit these to version control
SLACK_MCP_XOXC_TOKEN=xoxc-...
SLACK_MCP_XOXD_TOKEN=xoxd-...
```

**Purpose**: Keep tokens out of source code and logs

### 3. Graceful Authentication Fallback
```typescript
if (xoxc) {
  return createXOXCWebClient(xoxc, xoxd);
}
if (legacyBot) {
  return new WebClient(legacyBot);
}
```

**Purpose**: Support multiple authentication methods for flexibility

### 4. Clear Error Messages
```typescript
throw new McpError(
  ErrorCode.InvalidParams, 
  `Write access restricted: Messages can only be sent to #qa-release-status channel`
);
```

**Purpose**: Immediate feedback when security controls trigger

## Operational Security

### Token Rotation Process

1. **Detection**: Monitor for authentication errors
2. **Extraction**: Get fresh tokens from browser session
3. **Update**: Replace environment variables
4. **Restart**: Restart MCP server to use new tokens
5. **Verification**: Test with simple API call

### Monitoring Recommendations

1. **API Rate Limits**: Watch for unusual API usage patterns
2. **Channel Activity**: Monitor qa-release-status for unexpected posts
3. **Authentication Errors**: Alert on repeated auth failures
4. **Token Lifetime**: Track token age and plan rotation

### Incident Response

#### Token Compromise Suspected
1. **Immediate**: Revoke user session in Slack (logout all devices)
2. **Short-term**: Extract new tokens and restart service
3. **Long-term**: Audit all actions performed with compromised tokens

#### Unauthorized Channel Access
1. **Immediate**: Check channel write restrictions in code
2. **Short-term**: Review recent message history for unauthorized posts
3. **Long-term**: Consider additional authorization layers

## Compliance Considerations

### Data Access
- Service has read access to all channels user can access
- Includes private channels, DMs, and confidential discussions
- Must comply with data handling policies

### Audit Trail
- All actions logged under human user's name, not service identity
- May complicate audit and compliance reviews
- Consider separate service account if available

### Data Retention
- Service does not store message data locally
- All data access is real-time via Slack API
- Consider logging service actions separately for audit

## Alternative Approaches

If security requirements change, consider these alternatives:

### 1. Slack App with OAuth
- **Pros**: Proper service identity, scoped permissions, long-lived tokens
- **Cons**: Complex setup, requires workspace admin approval, limited channel access

### 2. Dedicated Service Account
- **Pros**: Clear audit trail, dedicated session management
- **Cons**: Requires additional user license, still uses session tokens

### 3. Webhook-Based Integration
- **Pros**: No stored credentials, event-driven
- **Cons**: One-way communication, complex setup, limited functionality

## Security Review Checklist

- [ ] Tokens stored securely (environment variables, not code)
- [ ] Channel write restrictions implemented and tested
- [ ] Token rotation process documented and practiced
- [ ] Monitoring for authentication errors in place
- [ ] Incident response plan documented
- [ ] Code review completed for all authentication logic
- [ ] Testing performed in isolated environment
- [ ] Security controls validated with negative testing

## Contact

For security questions or incident reporting:
- Security Team: [security@company.com]
- On-call: [oncall@company.com]
- Emergency: [emergency contact]

---

**Last Updated**: August 26, 2025  
**Next Review**: September 26, 2025  
**Document Owner**: Engineering Team