# LetterDrop

LetterDrop is a secure and efficient newsletter management service powered by Cloudflare Workers, enabling easy creation, distribution, and subscription management of newsletters.

## The story

I have been using `TinyLetter` to send newsletters to my subscribers, but unfortunately, Mailchimp has now shut down this free service. This isn't the first time I've faced such an issue, whenever this happens, I lose all my subscribers and have to look for a new way to send newsletters. To avoid this recurring problem, I've decided to build my own free newsletter service. It needs to be zero-cost, easy to use, and reliable so it won't get shut down. To achieve this, I'm using Cloudflare Workers to create the service, which I've named LetterDrop.

## How to use?

### Create a newsletter

1. Create a newsletter by sending a POST request to the `/api/newsletter` endpoint like this:

```bash
curl --request POST \
  --url https://ld.i365.tech/api/newsletter \
  --header 'Authorization: Bearer <<ADMIN_API_TOKEN>>' \
  --header 'CF-Access-Client-Id: <<CF-Access-Client-Id>>' \
  --header 'CF-Access-Client-Secret: <<CF-Access-Client-Secret>>' \
  --header 'content-type: application/json' \
  --data '{
    "title": "BMPI",
    "description": "BMPI weekly newsletter",
    "logo": "https://www.bmpi.dev/images/logo.png"
}'
```

2. Offline the newsletter by sending a PUT request to the `/api/newsletter/:id/offline` endpoint like this:

```bash
curl --request PUT \
  --url https://ld.i365.tech/api/newsletter/9080f810-e0f7-43aa-bac8-8d1cb3ceeff4/offline \
  --header 'Authorization: Bearer <<ADMIN_API_TOKEN>>' \
  --header 'CF-Access-Client-Id: <<CF-Access-Client-Id>>' \
  --header 'CF-Access-Client-Secret: <<CF-Access-Client-Secret>>'
```

__NOTE:__ These APIs should be protected by Cloudflare zero-trust security and a Worker-level bearer token (`ADMIN_API_TOKEN`). This keeps admin routes fail-closed if edge policy is accidentally changed.

### Subscribe or Unsubscribe to a newsletter

Just go to the newsletter page and click the subscribe or unsubscribe button. e.g. [BMPI](https://ld.i365.tech/newsletter/e0b379d3-0be0-4ae5-9fe2-cd972a667cdb).

Then you will receive an email to confirm your subscription or unsubscription. After that, you will receive the newsletter when it is published.

__NOTE:__ The newsletter page link pattern is `https://<<your-domain>>/newsletter/:id`. The subscription form now uses Cloudflare Turnstile and per-IP/per-target rate limiting to prevent abuse.

### Publish a newsletter

LetterDrop can publish newsletters from the admin API or from inbound email.

To publish directly through the admin API, send the newsletter content to `/api/newsletter/:id/publish` with the admin bearer token:

```bash
curl --request POST \
  --url https://newsletter.habengirma.com/api/newsletter/9080f810-e0f7-43aa-bac8-8d1cb3ceeff4/publish \
  --header 'Authorization: Bearer <ADMIN_API_TOKEN>' \
  --header 'Content-Type: application/json' \
  --data '{
    "subject": "BMPI Weekly Newsletter - 20240623",
    "html": "<h1>Hello subscribers</h1>",
    "text": "Hello subscribers",
    "sourceMessageId": "optional-idempotency-key"
  }'
```

LetterDrop can also publish newsletters from inbound email. The `ALLOWED_EMAILS` variable controls who can send newsletters through the inbound email paths.

If Cloudflare Email Routing is available, send newsletter content to the Email Routing address that triggers this Worker.

If inbound email is hosted in Google Workspace, use the Google Workspace bridge in `app/integrations/google-workspace-publish-bridge.gs`. Create a publish mailbox or alias, for example `publish@habengirma.com`, let the Apps Script read that mailbox, and have it POST matching Gmail messages to `/api/publish/google-workspace`.

__NOTE:__

- You should config the Email Worker to let it can be triggered by the specific email address. Please refer to the [Cloudflare Email Worker](https://developers.cloudflare.com/email-routing/setup/email-routing-addresses/) to know how to do it.
- Set `PUBLISH_EMAIL_ADDRESS` to the address users should send newsletter drafts to. Admin clients use `/api/newsletter/publish-config` to prefill compose windows.
- Set `PUBLISH_BRIDGE_TOKEN` as a Worker secret only when using the Google Workspace bridge. Store the same value in the Apps Script property `LETTERDROP_PUBLISH_TOKEN`.
- Inbound email subjects should be `[Newsletter-ID:<<the-newsletter-id>>]<<your-newsletter-title>>`, e.g. `[Newsletter-ID:9080f810-e0f7-43aa-bac8-8d1cb3ceeff4]BMPI Weekly Newsletter - 20240623`. Direct API publish requests use the newsletter ID from the path and do not need this subject tag.

#### Google Workspace bridge setup

1. Create a Google Workspace mailbox, alias, or group for publishing, for example `publish@habengirma.com`.
2. Generate a random bridge token and set it as a Worker secret:

```bash
cd app
npx wrangler secret put PUBLISH_BRIDGE_TOKEN
```

3. Copy `app/integrations/google-workspace-publish-bridge.gs` into an Apps Script project owned by the account that receives the publish messages.
4. Set these Apps Script properties:
   - `LETTERDROP_PUBLISH_ENDPOINT`: `https://newsletter.habengirma.com/api/publish/google-workspace`
   - `LETTERDROP_PUBLISH_TOKEN`: the same value as `PUBLISH_BRIDGE_TOKEN`
   - `LETTERDROP_PUBLISH_TO`: the publish mailbox or alias, for example `publish@habengirma.com`
5. Run `createLetterDropPublishTrigger()` once in Apps Script to process matching messages every five minutes.

## How to deploy?

To use LetterDrop, you need to create a Cloudflare account and deploy the Worker script. The Worker script is available in the `app` directory. You can deploy the Worker script using the Cloudflare Workers dashboard.

__NOTE:__ `app/wrangler.toml` is gitignored because it contains real resource IDs. To get started, copy the template and fill in your values:

```bash
cp app/wrangler.example.toml app/wrangler.toml
# Edit app/wrangler.toml with your Cloudflare resource IDs
```

### The dependencies

- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Cloudflare Email Workers](https://developers.cloudflare.com/email-routing/email-workers/)
- [Cloudflare KV](https://developers.cloudflare.com/kv/)
- [Cloudflare R2](https://developers.cloudflare.com/r2/)
- [Cloudflare Queues](https://developers.cloudflare.com/queues/#cloudflare-queues/)
- [Cloudflare D1](https://developers.cloudflare.com/d1)
  - Please refer to the [app/db/README.md](app/db/README.md) file to create the database.

### Variables

- `ALLOWED_EMAILS`: Comma-separated sender allowlist for the email worker.
- `PUBLISH_EMAIL_ADDRESS`: Email address that receives newsletter drafts. This can be a Cloudflare Email Routing address or a Google Workspace mailbox/alias used by the bridge.
- `PUBLIC_ORIGIN`: Public origin for subscription and unsubscribe links, for example `https://newsletter.habengirma.com`.
- `TURNSTILE_SITE_KEY`: Public site key for Cloudflare Turnstile.
- `SES_SNS_TOPIC_ARN`: Optional SES/SNS topic ARN. If set, the SES webhook rejects notifications from any other topic.

### Secrets

- `ADMIN_API_TOKEN`: Required bearer token for all `/api/newsletter*` admin APIs.
- `NOTIFICATION_SHARED_SECRET`: Shared secret sent to the notification service in `X-LetterDrop-Notification-Token`.
- `PUBLISH_BRIDGE_TOKEN`: Required bearer token for `/api/publish/google-workspace` only.
- `TURNSTILE_SECRET_KEY`: Secret key used to verify Turnstile tokens server-side.
- `UNSUBSCRIBE_SIGNING_SECRET`: HMAC secret used for stateless one-click unsubscribe links.
- `SES_SNS_WEBHOOK_TOKEN`: Shared secret embedded in the SES/SNS webhook URL.

### Deploy safety checks

- `npm --prefix app run check:wrangler`: Fails if your local `wrangler.toml` still contains placeholder bindings/IDs.
- `npm --prefix app run check:wrangler:template`: (CI) Validates that `wrangler.example.toml` has all required bindings.
- `npm --prefix app run smoke:deploy -- --env production`: Verifies required secrets and required D1 migration state before deployment.
- `npm --prefix app run deploy:safe`: Runs the local check and smoke test before deploy.

### How to setup the notification service?

Currently LetterDrop uses [AWS SES](https://aws.amazon.com/ses/) to send emails. You need to create an AWS account and configure SES to send emails. After that, you need to create a Cloudflare Worker as a notification service. The code is very simple, you can use the ChatGPT to generate the code.

For compliant newsletter delivery, configure SES and DNS before production sending:

- Enable Easy DKIM for the `habengirma.com` SES identity in `us-west-1`.
- Configure custom MAIL FROM as `bounce.habengirma.com`.
- Add DNS records:
  - `bounce.habengirma.com MX 10 feedback-smtp.us-west-1.amazonses.com`
  - `bounce.habengirma.com TXT "v=spf1 include:amazonses.com ~all"`
  - `_dmarc.habengirma.com TXT "v=DMARC1; p=none; rua=mailto:dmarc@habengirma.com; adkim=r; aspf=r"`
- Ensure `dmarc@habengirma.com` is monitored or routed.
- Create an SES configuration set named `haben-letterdrop`; publish bounce and complaint events to SNS and subscribe the LetterDrop webhook at `/api/ses/sns/<SES_SNS_WEBHOOK_TOKEN>`.
- Configure the notification worker with `workers_dev = false` and the same shared send secret as `SEND_EMAIL_SHARED_SECRET`.

### How to handle the failed emails?

LetterDrop uses Cloudflare Queues for delivery retries and a `SuppressionEvent` D1 table for SES bounce/complaint audit records. Permanent bounces and complaints from SES unsubscribe the affected subscriber for the tagged newsletter.

## What is the next step?

The next step is to add more features to LetterDrop.

- Improvments
  - [ ] Add the unit tests.
  - [ ] Add the email template.
  - [ ] Track the email open rate.
  - [ ] Support more third-party email services like SendGrid, Mailgun, etc.
- [ ] Support the mulit-tenant feature.
- [ ] Add the landing page.

## How to contribute?

I used the GPT-4o model to generate the code for LetterDrop. That means the code is generated by the AI model, and I only need to provide the prompts to the model. This approach is very efficient and can save a lot of time. I've also recorded a [video](https://www.youtube.com/playlist?list=PL21oMWN6Y7PCqSwbwesD4_wmXEVSeeQ7h) to show how to create the LetterDrop project using the GPT-4o model.

That also means you can easily customize the code by changing the prompts. You can find the prompts in the [CDDR](docs/CDDR//app.md) file.

Even I use the GPT model to generate the code, I still need to review the code and test it. So if you find any issues or have any suggestions, please feel free to create an issue or pull request. And there is no restriction on the contribution, you can contribute to any part of the project by yourself or with the help of the GPT model.

## Discussion

If you have any questions or suggestions, please feel free to create an issue or pull request. I'm happy to discuss with you. Or you can discuss it in this hacker news [thread](https://news.ycombinator.com/item?id=40764579).
