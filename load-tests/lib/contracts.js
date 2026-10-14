export const identifiesConfiguredPassword = (result) => !!(result && result.ok && result.body && result.body.state === 'password_login');
