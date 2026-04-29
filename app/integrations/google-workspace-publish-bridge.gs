/**
 * Google Workspace bridge for LetterDrop newsletter publishing.
 *
 * Configure these Apps Script properties before enabling the trigger:
 * - LETTERDROP_PUBLISH_ENDPOINT: https://newsletter.habengirma.com/api/publish/google-workspace
 * - LETTERDROP_PUBLISH_TOKEN: Worker secret PUBLISH_BRIDGE_TOKEN
 * - LETTERDROP_PUBLISH_TO: publish mailbox or alias, for example publish@habengirma.com
 *
 * Optional properties:
 * - LETTERDROP_LOOKBACK_DAYS: defaults to 30
 * - LETTERDROP_MAX_THREADS: defaults to 20
 * - LETTERDROP_PROCESSED_LABEL: defaults to LetterDrop/Processed
 * - LETTERDROP_FAILED_LABEL: defaults to LetterDrop/Failed
 */

function processLetterDropPublishInbox() {
  const endpoint = getRequiredScriptProperty("LETTERDROP_PUBLISH_ENDPOINT");
  const token = getRequiredScriptProperty("LETTERDROP_PUBLISH_TOKEN");
  const publishTo = getRequiredScriptProperty("LETTERDROP_PUBLISH_TO");
  const lookbackDays = getNumberScriptProperty("LETTERDROP_LOOKBACK_DAYS", 30);
  const maxThreads = getNumberScriptProperty("LETTERDROP_MAX_THREADS", 20);
  const processedLabel = getOrCreateLabel(
    getStringScriptProperty("LETTERDROP_PROCESSED_LABEL", "LetterDrop/Processed")
  );
  const failedLabel = getOrCreateLabel(
    getStringScriptProperty("LETTERDROP_FAILED_LABEL", "LetterDrop/Failed")
  );

  const query = [
    `to:${publishTo}`,
    'subject:"[Newsletter-ID:"',
    `newer_than:${lookbackDays}d`
  ].join(" ");
  const threads = GmailApp.search(query, 0, maxThreads);

  for (const thread of threads) {
    if (hasLabel(thread, processedLabel)) {
      continue;
    }

    let threadSucceeded = true;

    for (const message of thread.getMessages()) {
      if (message.isInTrash() || !message.getSubject().includes("[Newsletter-ID:")) {
        continue;
      }

      try {
        postMessageToLetterDrop(endpoint, token, message);
      } catch (error) {
        threadSucceeded = false;
        console.error(
          `LetterDrop publish bridge failed for Gmail message ${message.getId()}: ${error}`
        );
      }
    }

    if (threadSucceeded) {
      thread.removeLabel(failedLabel);
      thread.addLabel(processedLabel);
    } else {
      thread.addLabel(failedLabel);
    }
  }
}

function createLetterDropPublishTrigger() {
  ScriptApp.newTrigger("processLetterDropPublishInbox")
    .timeBased()
    .everyMinutes(5)
    .create();
}

function postMessageToLetterDrop(endpoint, token, message) {
  const response = UrlFetchApp.fetch(endpoint, {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: `Bearer ${token}`
    },
    payload: JSON.stringify({
      from: message.getFrom(),
      to: message.getTo(),
      subject: message.getSubject(),
      html: message.getBody(),
      text: message.getPlainBody(),
      sourceMessageId: message.getId(),
      messageId: message.getId(),
      receivedAt: message.getDate().toISOString()
    }),
    muteHttpExceptions: true
  });

  const statusCode = response.getResponseCode();
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(
      `LetterDrop returned HTTP ${statusCode}: ${response.getContentText()}`
    );
  }
}

function getRequiredScriptProperty(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) {
    throw new Error(`Missing script property ${name}`);
  }
  return value;
}

function getStringScriptProperty(name, defaultValue) {
  return PropertiesService.getScriptProperties().getProperty(name) || defaultValue;
}

function getNumberScriptProperty(name, defaultValue) {
  const rawValue = PropertiesService.getScriptProperties().getProperty(name);
  const value = rawValue ? Number(rawValue) : defaultValue;
  return Number.isFinite(value) && value > 0 ? value : defaultValue;
}

function getOrCreateLabel(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function hasLabel(thread, label) {
  return thread.getLabels().some((threadLabel) => (
    threadLabel.getName() === label.getName()
  ));
}
