import { createZendeskTicket } from '../../../../connectors/zendesk.js';

/**
 * Create a Zendesk ticket when a low-rated review is received
 * @param {Object} options - Job options
 * @param {Object} options.payload - Review data
 * @param {Object} options.env - Environment variables
 * @param {Object} options.secrets - Secrets with Zendesk credentials
 */
export async function process({ payload: review, env, secrets }) {
  const rating = review.rating ?? review.stars ?? review.starRating;
  if (rating === undefined || rating > 2) {
    return;
  }

  const auth = {
    subdomain: env.ZENDESK_SUBDOMAIN || secrets.ZENDESK_SUBDOMAIN,
    email: env.ZENDESK_EMAIL || secrets.ZENDESK_EMAIL,
    apiToken: env.ZENDESK_API_TOKEN || secrets.ZENDESK_API_TOKEN
  };

  const subject = `Low review (${rating}\u2605)`;
  const body = review.body || review.message || '';

  await createZendeskTicket(auth, { subject, comment: { body } });
}
