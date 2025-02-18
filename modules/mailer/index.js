'use strict';

var inlineCss = require('./inlineCss');
var config = require('config');
var fs = require('fs');
var path = require('path');
var jade = require('lib/serverJade');
var logoBase64 = fs.readFileSync(path.join(config.projectRoot, 'assets/img/logo.png')).toString('base64');
var log = require('log')();
var Letter = require('./models/letter');
var AWS = require('aws');

const nodemailer = require('nodemailer');
const htmlToText = require('nodemailer-html-to-text').htmlToText;
const stubTransport = require('nodemailer-stub-transport');
const sesTransport = require('nodemailer-ses-transport');

const transportEngine = (process.env.NODE_ENV == 'test' || process.env.MAILER_DISABLED) ? stubTransport() : sesTransport({
  ses: new AWS.SES(),
//  pool: true, not needed for SES?
  rateLimit: 50
});

const transport = nodemailer.createTransport(transportEngine);

transport.use('compile', htmlToText());

// some clients don't allow svg
// var logoSrc = yield fs.readFile(path.join(config.projectRoot, 'assets/img/logo.svg'));

// not middleware, cause can be used in CRON-based runs, from onPaid callback
// mail can be sent outside of request context

/**
 * create & save a letter object
 * we save it to db to track delivery status
 *
 * Doesn't send the letter
 * Can use to send it letter
 * @param options
 * @returns {Letter}
 */
function* createLetter(options) {
  var message = {};

  var sender = config.mailer.senders[options.from || 'default'];
  if (!sender) {
    throw new Error("Unknown sender:" + options.from);
  }

  var locals = Object.create(options);
  Object.assign(locals, config.jade);

  locals.lang = config.lang;
  locals.domain = config.domain;
  locals.logoBase64 = logoBase64;
  locals.signature = sender.signature;

  var templatePath = options.templatePath;
  if (!templatePath.endsWith('.jade')) templatePath += '.jade';

  var letterHtml = jade.renderFile(templatePath, locals);
  letterHtml = yield inlineCss(letterHtml);

  message.from = {
    name: sender.fromName,
    address: sender.fromEmail
  };

  message.to = (typeof options.to == 'string') ? {address: options.to} : options.to;

  if (!message.to.address) {
    throw new Error("No email for recepient, message options:" + JSON.stringify(options));
  }


  message.html = letterHtml;

  message.subject = options.subject;

  message.headers = options.headers;

  return yield Letter.create({
    message: message,
    labelId: options.labelId,
    label:   options.label
  });

}

/**
 * A shortcut to send a letter
 * E.g send({to: ..., subject: ..., templatePath: ... })
 * @param options
 * @returns {*}
 */
function* send(options) {
  var letter = yield* createLetter(options);

  return yield* sendLetter(letter);
}

/**
 * Send an existing letter
 * @param letter
 * @returns {*}
 */
function* sendLetter(letter) {

  let result = yield transport.sendMail(letter.message);

  letter.transportResponse = result;

  if (result.messageId) {
    letter.messageId = result.messageId.replace(/@email.amazonses.com$/, '');
  }

  letter.sent = true;

  log.debug("sent ", letter.toObject());

  yield letter.persist();

  return letter;
}


exports.init = function(app) {
};


exports.Letter = require('./models/letter');
exports.inlineCss = inlineCss;
exports.send = send;
exports.createLetter = createLetter;
exports.sendLetter = sendLetter;
exports.StatusService = require('./lib/statusService');

if (process.env.MAILER_DISABLED) {
  console.log("MAILER DISABLED");
}
