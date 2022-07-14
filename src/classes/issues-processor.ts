import * as core from '@actions/core';
import {context, getOctokit} from '@actions/github';
import {GitHub} from '@actions/github/lib/utils';
import {Option} from '../enums/option';
import {getHumanizedDate} from '../functions/dates/get-humanized-date';
import {isDateMoreRecentThan} from '../functions/dates/is-date-more-recent-than';
import {isValidDate} from '../functions/dates/is-valid-date';
import {isBoolean} from '../functions/is-boolean';
import {isLabeled} from '../functions/is-labeled';
import {cleanLabel} from '../functions/clean-label';
import {shouldMarkWhenStale} from '../functions/should-mark-when-stale';
import {wordsToList} from '../functions/words-to-list';
import {IComment} from '../interfaces/comment';
import {IIssueEvent} from '../interfaces/issue-event';
import {IIssuesProcessorOptions} from '../interfaces/issues-processor-options';
import {IPullRequest} from '../interfaces/pull-request';
import {Assignees} from './assignees';
import {IgnoreUpdates} from './ignore-updates';
import {ExemptDraftPullRequest} from './exempt-draft-pull-request';
import {Issue} from './issue';
import {IssueLogger} from './loggers/issue-logger';
import {Logger} from './loggers/logger';
import {Milestones} from './milestones';
import {StaleOperations} from './stale-operations';
import {Statistics} from './statistics';
import {LoggerService} from '../services/logger.service';
import {OctokitIssue} from '../interfaces/issue';
import {IUser} from '../interfaces/user';

/***
 * Handle processing of issues for staleness/closure.
 */
export class IssuesProcessor {
  private static _updatedSince(timestamp: string, num_days: number): boolean {
    const daysInMillis = 1000 * 60 * 60 * 24 * num_days;
    const millisSinceLastUpdated =
      new Date().getTime() - new Date(timestamp).getTime();

    return millisSinceLastUpdated <= daysInMillis;
  }

  private static getDaysSince(timestamp: string): number {
    const diffTime = Math.abs(
      new Date().getTime() - new Date(timestamp).getTime()
    );
    return diffTime / (1000 * 60 * 60 * 24);
  }

  private static isOlderThanDaysAgo(
    timestamp: string,
    num_days: number
  ): boolean {
    const daysInMillis = 1000 * 60 * 60 * 24 * num_days;
    const millisSinceLastUpdated =
      new Date().getTime() - new Date(timestamp).getTime();

    return millisSinceLastUpdated >= daysInMillis;
  }

  private static getNow(): string {
    const withoutMilliseconds = new Date().toISOString().split('.')[0];
    return `${withoutMilliseconds}Z`;
  }

  private static _endIssueProcessing(issue: Issue): void {
    const consumedOperationsCount: number =
      issue.operations.getConsumedOperationsCount();

    if (consumedOperationsCount > 0) {
      const issueLogger: IssueLogger = new IssueLogger(issue);

      issueLogger.info(
        LoggerService.cyan(consumedOperationsCount),
        `operation${
          consumedOperationsCount > 1 ? 's' : ''
        } consumed for this $$type`
      );
    }
  }

  private static _getCloseLabelUsedOptionName(
    issue: Readonly<Issue>
  ): Option.ClosePrLabel | Option.CloseIssueLabel {
    return issue.isPullRequest ? Option.ClosePrLabel : Option.CloseIssueLabel;
  }

  readonly operations: StaleOperations;
  readonly client: InstanceType<typeof GitHub>;
  readonly options: IIssuesProcessorOptions;
  readonly staleIssues: Issue[] = [];
  readonly closedIssues: Issue[] = [];
  readonly deletedBranchIssues: Issue[] = [];
  readonly removedLabelIssues: Issue[] = [];
  readonly addedLabelIssues: Issue[] = [];
  readonly addedCloseCommentIssues: Issue[] = [];
  readonly statistics: Statistics | undefined;
  readonly maintainers: string[] = [];
  private readonly _logger: Logger = new Logger();

  constructor(options: IIssuesProcessorOptions) {
    this.options = options;
    this.client = getOctokit(this.options.repoToken);
    this.operations = new StaleOperations(this.options);

    this._logger.info(
      LoggerService.yellow(`Starting the stale action process...`)
    );

    if (this.options.debugOnly) {
      this._logger.warning(
        LoggerService.yellowBright(`Executing in debug mode!`)
      );
      this._logger.warning(
        LoggerService.yellowBright(
          `The debug output will be written but no issues/PRs will be processed.`
        )
      );
    }

    if (this.options.enableStatistics) {
      this.statistics = new Statistics();
    }
  }

  async getMaintainers(): Promise<string[]> {
    return (await this.client.rest.orgs.listMembers({org: 'mlflow'})).data.map(
      ({login}) => login
    );
  }

  async setMaintainers() {
    this.maintainers.push(...(await this.getMaintainers()));
  }

  createMarkdownComment(message: string): string {
    return `<!-- ${message} -->`;
  }

  getCommentTags() {
    return {
      assignMaintainer: this.createMarkdownComment('assign-maintainer'),
      triageIssue: this.createMarkdownComment('triage-issue'),
      reminderToMaintainers: this.createMarkdownComment(
        'reminder-to-maintainers'
      ),
      reminderToIssueAuthor: this.createMarkdownComment(
        'reminder-to-issue-author'
      )
    };
  }

  async createComment(issue: Issue, body: string) {
    const issueLogger: IssueLogger = new IssueLogger(issue);
    issueLogger.info(`Creating a comment (body: ${body})...`);
    if (!this.options.debugOnly) {
      this._consumeIssueOperation(issue);
      try {
        await this.client.rest.issues.createComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: issue.number,
          body
        });
      } catch (error) {
        issueLogger.error(`Error when creating a comment: ${error.message}`);
      }
    }
  }

  async processIssues(page: Readonly<number> = 1): Promise<number> {
    // get the next batch of issues
    const issues: Issue[] = await this.getIssues(page);

    if (issues.length <= 0) {
      this._logger.info(
        LoggerService.green(`No more issues found to process. Exiting...`)
      );
      this.statistics
        ?.setOperationsCount(this.operations.getConsumedOperationsCount())
        .logStats();

      return this.operations.getRemainingOperationsCount();
    } else {
      this._logger.info(
        `${LoggerService.yellow(
          'Processing the batch of issues'
        )} ${LoggerService.cyan(`#${page}`)} ${LoggerService.yellow(
          'containing'
        )} ${LoggerService.cyan(issues.length)} ${LoggerService.yellow(
          `issue${issues.length > 1 ? 's' : ''}...`
        )}`
      );
    }

    const labelsToAddWhenUnstale: string[] = wordsToList(
      this.options.labelsToAddWhenUnstale
    );
    const labelsToRemoveWhenUnstale: string[] = wordsToList(
      this.options.labelsToRemoveWhenUnstale
    );

    for (const issue of issues.values()) {
      // Stop the processing if no more operations remains
      if (!this.operations.hasRemainingOperations()) {
        break;
      }

      const issueLogger: IssueLogger = new IssueLogger(issue);
      await issueLogger.grouping(`$$type #${issue.number}`, async () => {
        await this.processIssue(
          issue,
          labelsToAddWhenUnstale,
          labelsToRemoveWhenUnstale
        );
      });
    }

    if (!this.operations.hasRemainingOperations()) {
      this._logger.warning(
        LoggerService.yellowBright(`No more operations left! Exiting...`)
      );
      this._logger.warning(
        `${LoggerService.yellowBright(
          'If you think that not enough issues were processed you could try to increase the quantity related to the'
        )} ${this._logger.createOptionLink(
          Option.OperationsPerRun
        )} ${LoggerService.yellowBright(
          'option which is currently set to'
        )} ${LoggerService.cyan(this.options.operationsPerRun)}`
      );
      this.statistics
        ?.setOperationsCount(this.operations.getConsumedOperationsCount())
        .logStats();

      return 0;
    }

    this._logger.info(
      `${LoggerService.green('Batch')} ${LoggerService.cyan(
        `#${page}`
      )} ${LoggerService.green('processed.')}`
    );

    // Do the next batch
    return this.processIssues(page + 1);
  }

  async processIssue(
    issue: Issue,
    labelsToAddWhenUnstale: Readonly<string>[],
    labelsToRemoveWhenUnstale: Readonly<string>[]
  ): Promise<void> {
    this.statistics?.incrementProcessedItemsCount(issue);

    const issueLogger: IssueLogger = new IssueLogger(issue);
    issueLogger.info(
      `Found this $$type last updated at: ${LoggerService.cyan(
        issue.updated_at
      )}`
    );

    // calculate string based messages for this issue
    const staleMessage: string = issue.isPullRequest
      ? this.options.stalePrMessage
      : this.options.staleIssueMessage;
    const closeMessage: string = issue.isPullRequest
      ? this.options.closePrMessage
      : this.options.closeIssueMessage;
    const staleLabel: string = issue.isPullRequest
      ? this.options.stalePrLabel
      : this.options.staleIssueLabel;
    const closeLabel: string = issue.isPullRequest
      ? this.options.closePrLabel
      : this.options.closeIssueLabel;
    const skipMessage = issue.isPullRequest
      ? this.options.stalePrMessage.length === 0
      : this.options.staleIssueMessage.length === 0;
    const daysBeforeStale: number = issue.isPullRequest
      ? this._getDaysBeforePrStale()
      : this._getDaysBeforeIssueStale();

    if (issue.state === 'closed') {
      issueLogger.info(`Skipping this $$type because it is closed`);
      IssuesProcessor._endIssueProcessing(issue);
      return; // Don't process closed issues
    }

    if (issue.locked) {
      issueLogger.info(`Skipping this $$type because it is locked`);
      IssuesProcessor._endIssueProcessing(issue);
      return; // Don't process locked issues
    }

    const onlyLabels: string[] = wordsToList(this._getOnlyLabels(issue));

    if (onlyLabels.length > 0) {
      issueLogger.info(
        `The option ${issueLogger.createOptionLink(
          Option.OnlyLabels
        )} was specified to only process issues and pull requests with all those labels (${LoggerService.cyan(
          onlyLabels.length
        )})`
      );

      const hasAllWhitelistedLabels: boolean = onlyLabels.every(
        (label: Readonly<string>): boolean => {
          return isLabeled(issue, label);
        }
      );

      if (!hasAllWhitelistedLabels) {
        issueLogger.info(
          LoggerService.white('└──'),
          `Skipping this $$type because it doesn't have all the required labels`
        );

        IssuesProcessor._endIssueProcessing(issue);
        return; // Don't process issues without all of the required labels
      } else {
        issueLogger.info(
          LoggerService.white('├──'),
          `All the required labels are present on this $$type`
        );
        issueLogger.info(
          LoggerService.white('└──'),
          `Continuing the process for this $$type`
        );
      }
    } else {
      issueLogger.info(
        `The option ${issueLogger.createOptionLink(
          Option.OnlyLabels
        )} was not specified`
      );
      issueLogger.info(
        LoggerService.white('└──'),
        `Continuing the process for this $$type`
      );
    }

    issueLogger.info(
      `Days before $$type stale: ${LoggerService.cyan(daysBeforeStale)}`
    );

    const shouldMarkAsStale: boolean = shouldMarkWhenStale(daysBeforeStale);

    // Try to remove the close label when not close/locked issue or PR
    await this._removeCloseLabel(issue, closeLabel);

    if (this.options.startDate) {
      const startDate: Date = new Date(this.options.startDate);
      const createdAt: Date = new Date(issue.created_at);

      issueLogger.info(
        `A start date was specified for the ${getHumanizedDate(
          startDate
        )} (${LoggerService.cyan(this.options.startDate)})`
      );

      // Expecting that GitHub will always set a creation date on the issues and PRs
      // But you never know!
      if (!isValidDate(createdAt)) {
        IssuesProcessor._endIssueProcessing(issue);
        core.setFailed(
          new Error(`Invalid issue field: "created_at". Expected a valid date`)
        );
      }

      issueLogger.info(
        `$$type created the ${getHumanizedDate(
          createdAt
        )} (${LoggerService.cyan(issue.created_at)})`
      );

      if (!isDateMoreRecentThan(createdAt, startDate)) {
        issueLogger.info(
          `Skipping this $$type because it was created before the specified start date`
        );

        IssuesProcessor._endIssueProcessing(issue);
        return; // Don't process issues which were created before the start date
      }
    }

    if (this.options.mlflow && !issue.isStale) {
      const mlflowAutomationUsername = 'mlflow-automation';
      const createMentions = (logins: string[]): string =>
        logins.map(login => `@${login}`).join(' ');

      const isMaintainer = (user: IUser): boolean =>
        user.type === 'User' && this.maintainers.includes(user.login);

      const isBot = (user: IUser | null) => {
        if (!user) {
          return false;
        }
        return user.type !== 'User' || user.login === mlflowAutomationUsername;
      };

      const TAGS = this.getCommentTags();

      if (issue.isPullRequest) {
        // TODO
      } else {
        const daysSinceIssueCreated = IssuesProcessor.getDaysSince(
          issue.created_at
        ).toFixed(2);
        issueLogger.info(
          `Days since this issue was created: ${daysSinceIssueCreated}`
        );
        if (
          !IssuesProcessor.isOlderThanDaysAgo(
            issue.created_at,
            this.options.daysBeforeTriageReminders
          )
        ) {
          return;
        }

        issueLogger.info(
          `Assignees on this issue: ${issue.assignees.map(({login}) => login)}`
        );
        const hasMaintainerAssignee = issue.assignees.some(user =>
          isMaintainer(user)
        );
        const issueComments = await this.listIssueComments(
          issue,
          issue.created_at
        );
        const lastComment: IComment | undefined =
          issueComments.length > 0
            ? issueComments[issueComments.length - 1]
            : undefined;

        if (!hasMaintainerAssignee) {
          issueLogger.info('This issue has no assignees');
          const sentAssigneeReminderBefore = issueComments.some(({body}) =>
            body?.includes(TAGS.assignMaintainer)
          );
          if (!sentAssigneeReminderBefore) {
            const maintainersToMention = [
              'BenWilson2',
              'dbczumar',
              'harupy',
              'WeichenXu123'
            ];
            const mentions = createMentions(maintainersToMention);
            await this.createComment(
              issue,
              `${TAGS.assignMaintainer}\n${mentions} Please assign a maintainer and start triaging this issue.`
            );
          }
          return;
        }

        if (!lastComment) {
          const mentions = createMentions(
            issue.assignees
              .filter(assignee => isMaintainer(assignee))
              .map(({login}) => login)
          );
          this.createComment(
            issue,
            `${TAGS.triageIssue}\n${mentions} Please triage this issue.`
          );
          return;
        }

        const hasClosingPr = issue.labels.some(
          ({name}) => name === 'has-closing-pr'
        );
        if (hasClosingPr) {
          issueLogger.info('This issue has a closing PR.');
          return;
        }

        const botPostedLastComment = isBot(lastComment.user);
        issueLogger.info(
          `Did a bot post the last comment? ${botPostedLastComment}`
        );

        const lastCommentCreatedAt =
          lastComment.created_at || IssuesProcessor.getNow();
        const daysSinceLastCommentCreated =
          IssuesProcessor.getDaysSince(lastCommentCreatedAt).toFixed(2);
        issueLogger.info(
          `Days since the last comment was created: ${daysSinceLastCommentCreated}`
        );
        if (
          !IssuesProcessor.isOlderThanDaysAgo(
            lastCommentCreatedAt,
            this.options.daysBeforeReplyReminder
          )
        ) {
          return;
        }
        if (!botPostedLastComment) {
          const maintainerPostedLastComment = lastComment.user
            ? isMaintainer(lastComment.user)
            : false;
          issueLogger.info(
            `Did a maintainer post the last comment? ${maintainerPostedLastComment}`
          );
          if (maintainerPostedLastComment) {
            const mention = issue.user ? `@${issue.user.login}` : '';
            await this.createComment(
              issue,
              `${TAGS.reminderToIssueAuthor}\n${mention} Any updates here? If you're working on a PR, please link it to this issue.`
            );
            return;
          } else {
            const mentions = createMentions(
              issue.assignees
                .filter(assignee => isMaintainer(assignee))
                .map(({login}) => login)
            );
            await this.createComment(
              issue,
              `${TAGS.reminderToMaintainers}\n${mentions} Please reply to comments.`
            );
            return;
          }
        }

        // We should not stale an issue that has no comments from maintainers
        const hasMaintainerComment = issueComments.some(({user}) =>
          user ? isMaintainer(user) : false
        );
        if (!hasMaintainerComment) {
          issueLogger.info('This issue has no comments from maintainers.');
          return;
        }

        if (
          botPostedLastComment &&
          lastComment.body?.includes(TAGS.reminderToMaintainers)
        ) {
          issueLogger.info(
            'The last comment is a reminder to maintainers posted by a bot.'
          );
          return;
        }

        if (issue.milestone) {
          issueLogger.info(
            'This issue is a milestone, should not be stalled/closed.'
          );
          return;
        }
      }
    }

    if (issue.isStale) {
      issueLogger.info(`This $$type has a stale label`);
    } else {
      issueLogger.info(`This $$type hasn't a stale label`);
    }

    const exemptLabels: string[] = wordsToList(
      issue.isPullRequest
        ? this.options.exemptPrLabels
        : this.options.exemptIssueLabels
    );

    if (
      exemptLabels.some((exemptLabel: Readonly<string>): boolean =>
        isLabeled(issue, exemptLabel)
      )
    ) {
      if (issue.isStale) {
        issueLogger.info(`An exempt label was added after the stale label.`);
        await this._removeStaleLabel(issue, staleLabel);
      }

      issueLogger.info(`Skipping this $$type because it has an exempt label`);
      IssuesProcessor._endIssueProcessing(issue);
      return; // Don't process exempt issues
    }

    const anyOfLabels: string[] = wordsToList(this._getAnyOfLabels(issue));

    if (anyOfLabels.length > 0) {
      issueLogger.info(
        `The option ${issueLogger.createOptionLink(
          Option.AnyOfLabels
        )} was specified to only process the issues and pull requests with one of those labels (${LoggerService.cyan(
          anyOfLabels.length
        )})`
      );

      const hasOneOfWhitelistedLabels: boolean = anyOfLabels.some(
        (label: Readonly<string>): boolean => {
          return isLabeled(issue, label);
        }
      );

      if (!hasOneOfWhitelistedLabels) {
        issueLogger.info(
          LoggerService.white('└──'),
          `Skipping this $$type because it doesn't have one of the required labels`
        );
        IssuesProcessor._endIssueProcessing(issue);
        return; // Don't process issues without any of the required labels
      } else {
        issueLogger.info(
          LoggerService.white('├──'),
          `One of the required labels is present on this $$type`
        );
        issueLogger.info(
          LoggerService.white('└──'),
          `Continuing the process for this $$type`
        );
      }
    } else {
      issueLogger.info(
        `The option ${issueLogger.createOptionLink(
          Option.AnyOfLabels
        )} was not specified`
      );
      issueLogger.info(
        LoggerService.white('└──'),
        `Continuing the process for this $$type`
      );
    }

    const milestones: Milestones = new Milestones(this.options, issue);

    if (milestones.shouldExemptMilestones()) {
      IssuesProcessor._endIssueProcessing(issue);
      return; // Don't process exempt milestones
    }

    const assignees: Assignees = new Assignees(this.options, issue);

    if (assignees.shouldExemptAssignees()) {
      IssuesProcessor._endIssueProcessing(issue);
      return; // Don't process exempt assignees
    }

    // Ignore draft PR
    // Note that this check is so far below because it cost one read operation
    // So it's simply better to do all the stale checks which don't cost more operation before this one
    const exemptDraftPullRequest: ExemptDraftPullRequest =
      new ExemptDraftPullRequest(this.options, issue);

    if (
      await exemptDraftPullRequest.shouldExemptDraftPullRequest(
        async (): Promise<IPullRequest | undefined | void> => {
          return this.getPullRequest(issue);
        }
      )
    ) {
      IssuesProcessor._endIssueProcessing(issue);
      return; // Don't process draft PR
    }

    // Determine if this issue needs to be marked stale first
    if (!issue.isStale) {
      issueLogger.info(`This $$type is not stale`);
      const shouldIgnoreUpdates: boolean = new IgnoreUpdates(
        this.options,
        issue
      ).shouldIgnoreUpdates();

      // Should this issue be marked as stale?
      let shouldBeStale: boolean;

      // Ignore the last update and only use the creation date
      if (shouldIgnoreUpdates) {
        shouldBeStale = !IssuesProcessor._updatedSince(
          issue.created_at,
          daysBeforeStale
        );
      }
      // Use the last update to check if we need to stale
      else {
        shouldBeStale = !IssuesProcessor._updatedSince(
          issue.updated_at,
          daysBeforeStale
        );
      }

      if (shouldBeStale) {
        if (shouldIgnoreUpdates) {
          issueLogger.info(
            `This $$type should be stale based on the creation date the ${getHumanizedDate(
              new Date(issue.created_at)
            )} (${LoggerService.cyan(issue.created_at)})`
          );
        } else {
          issueLogger.info(
            `This $$type should be stale based on the last update date the ${getHumanizedDate(
              new Date(issue.updated_at)
            )} (${LoggerService.cyan(issue.updated_at)})`
          );
        }

        if (shouldMarkAsStale) {
          issueLogger.info(
            `This $$type should be marked as stale based on the option ${issueLogger.createOptionLink(
              this._getDaysBeforeStaleUsedOptionName(issue)
            )} (${LoggerService.cyan(daysBeforeStale)})`
          );
          await this._markStale(issue, staleMessage, staleLabel, skipMessage);
          issue.isStale = true; // This issue is now considered stale
          issue.markedStaleThisRun = true;
          issueLogger.info(`This $$type is now stale`);
        } else {
          issueLogger.info(
            `This $$type should not be marked as stale based on the option ${issueLogger.createOptionLink(
              this._getDaysBeforeStaleUsedOptionName(issue)
            )} (${LoggerService.cyan(daysBeforeStale)})`
          );
        }
      } else {
        if (shouldIgnoreUpdates) {
          issueLogger.info(
            `This $$type should not be stale based on the creation date the ${getHumanizedDate(
              new Date(issue.created_at)
            )} (${LoggerService.cyan(issue.created_at)})`
          );
        } else {
          issueLogger.info(
            `This $$type should not be stale based on the last update date the ${getHumanizedDate(
              new Date(issue.updated_at)
            )} (${LoggerService.cyan(issue.updated_at)})`
          );
        }
      }
    }

    // Process the issue if it was marked stale
    if (issue.isStale) {
      issueLogger.info(`This $$type is already stale`);
      await this._processStaleIssue(
        issue,
        staleLabel,
        staleMessage,
        labelsToAddWhenUnstale,
        labelsToRemoveWhenUnstale,
        closeMessage,
        closeLabel
      );
    }

    IssuesProcessor._endIssueProcessing(issue);
  }

  // Grab comments for an issue since a given date
  async listIssueComments(
    issue: Readonly<Issue>,
    sinceDate: Readonly<string>
  ): Promise<IComment[]> {
    // Find any comments since date on the given issue
    try {
      this._consumeIssueOperation(issue);
      this.statistics?.incrementFetchedItemsCommentsCount();
      const comments = await this.client.paginate(
        this.client.rest.issues.listComments,
        {
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: issue.number,
          since: sinceDate,
          per_page: 100
        }
      );
      return comments;
    } catch (error) {
      this._logger.error(`List issue comments error: ${error.message}`);
      return Promise.resolve([]);
    }
  }

  // grab issues from github in batches of 100
  async getIssues(page: number): Promise<Issue[]> {
    try {
      this.operations.consumeOperation();
      const issueResult = await this.client.rest.issues.listForRepo({
        owner: context.repo.owner,
        repo: context.repo.repo,
        state: 'open',
        per_page: 100,
        direction: this.options.ascending ? 'asc' : 'desc',
        page
      });
      this.statistics?.incrementFetchedItemsCount(issueResult.data.length);

      return issueResult.data.map(
        (issue: Readonly<OctokitIssue>): Issue => new Issue(this.options, issue)
      );
    } catch (error) {
      this._logger.error(`Get issues for repo error: ${error.message}`);
      return Promise.resolve([]);
    }
  }

  // returns the creation date of a given label on an issue (or nothing if no label existed)
  ///see https://developer.github.com/v3/activity/events/
  async getLabelCreationDate(
    issue: Issue,
    label: string
  ): Promise<string | undefined> {
    const issueLogger: IssueLogger = new IssueLogger(issue);

    issueLogger.info(`Checking for label on this $$type`);

    this._consumeIssueOperation(issue);
    this.statistics?.incrementFetchedItemsEventsCount();
    const options = this.client.rest.issues.listEvents.endpoint.merge({
      owner: context.repo.owner,
      repo: context.repo.repo,
      per_page: 100,
      issue_number: issue.number
    });

    const events: IIssueEvent[] = await this.client.paginate(options);
    const reversedEvents = events.reverse();

    const staleLabeledEvent = reversedEvents.find(
      event =>
        event.event === 'labeled' &&
        cleanLabel(event.label.name) === cleanLabel(label)
    );

    if (!staleLabeledEvent) {
      // Must be old rather than labeled
      return undefined;
    }

    return staleLabeledEvent.created_at;
  }

  async getPullRequest(issue: Issue): Promise<IPullRequest | undefined | void> {
    const issueLogger: IssueLogger = new IssueLogger(issue);

    try {
      this._consumeIssueOperation(issue);
      this.statistics?.incrementFetchedPullRequestsCount();

      const pullRequest = await this.client.rest.pulls.get({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: issue.number
      });

      return pullRequest.data;
    } catch (error) {
      issueLogger.error(`Error when getting this $$type: ${error.message}`);
    }
  }

  // handle all of the stale issue logic when we find a stale issue
  private async _processStaleIssue(
    issue: Issue,
    staleLabel: string,
    staleMessage: string,
    labelsToAddWhenUnstale: Readonly<string>[],
    labelsToRemoveWhenUnstale: Readonly<string>[],
    closeMessage?: string,
    closeLabel?: string
  ) {
    const issueLogger: IssueLogger = new IssueLogger(issue);
    const markedStaleOn: string =
      (await this.getLabelCreationDate(issue, staleLabel)) || issue.updated_at;
    issueLogger.info(
      `$$type marked stale on: ${LoggerService.cyan(markedStaleOn)}`
    );

    const issueHasComments: boolean = await this._hasCommentsSince(
      issue,
      markedStaleOn,
      staleMessage
    );
    issueLogger.info(
      `$$type has been commented on: ${LoggerService.cyan(issueHasComments)}`
    );

    const daysBeforeClose: number = issue.isPullRequest
      ? this._getDaysBeforePrClose()
      : this._getDaysBeforeIssueClose();

    issueLogger.info(
      `Days before $$type close: ${LoggerService.cyan(daysBeforeClose)}`
    );

    const issueHasUpdate: boolean = IssuesProcessor._updatedSince(
      issue.updated_at,
      daysBeforeClose
    );
    issueLogger.info(
      `$$type has been updated: ${LoggerService.cyan(issueHasUpdate)}`
    );

    const shouldRemoveStaleWhenUpdated: boolean =
      this._shouldRemoveStaleWhenUpdated(issue);

    issueLogger.info(
      `The option ${issueLogger.createOptionLink(
        this._getRemoveStaleWhenUpdatedUsedOptionName(issue)
      )} is: ${LoggerService.cyan(shouldRemoveStaleWhenUpdated)}`
    );

    if (shouldRemoveStaleWhenUpdated) {
      issueLogger.info(`The stale label should not be removed`);
    } else {
      issueLogger.info(
        `The stale label should be removed if all conditions met`
      );
    }

    if (issue.markedStaleThisRun) {
      issueLogger.info(`marked stale this run, so don't check for updates`);
    }

    // Should we un-stale this issue?
    if (
      shouldRemoveStaleWhenUpdated &&
      issueHasComments &&
      !issue.markedStaleThisRun
    ) {
      issueLogger.info(
        `Remove the stale label since the $$type has a comment and the workflow should remove the stale label when updated`
      );
      await this._removeStaleLabel(issue, staleLabel);

      // Are there labels to remove or add when an issue is no longer stale?
      await this._removeLabelsWhenUnstale(issue, labelsToRemoveWhenUnstale);
      await this._addLabelsWhenUnstale(issue, labelsToAddWhenUnstale);

      issueLogger.info(`Skipping the process since the $$type is now un-stale`);

      return; // Nothing to do because it is no longer stale
    }

    // Now start closing logic
    if (daysBeforeClose < 0) {
      return; // Nothing to do because we aren't closing stale issues
    }

    if (!issueHasComments && !issueHasUpdate) {
      issueLogger.info(
        `Closing $$type because it was last updated on: ${LoggerService.cyan(
          issue.updated_at
        )}`
      );
      await this._closeIssue(issue, closeMessage, closeLabel);

      if (this.options.deleteBranch && issue.pull_request) {
        issueLogger.info(
          `Deleting the branch since the option ${issueLogger.createOptionLink(
            Option.DeleteBranch
          )} is enabled`
        );
        await this._deleteBranch(issue);
        this.deletedBranchIssues.push(issue);
      }
    } else {
      issueLogger.info(
        `Stale $$type is not old enough to close yet (hasComments? ${issueHasComments}, hasUpdate? ${issueHasUpdate})`
      );
    }
  }

  // checks to see if a given issue is still stale (has had activity on it)
  private async _hasCommentsSince(
    issue: Issue,
    sinceDate: string,
    staleMessage: string
  ): Promise<boolean> {
    const issueLogger: IssueLogger = new IssueLogger(issue);

    issueLogger.info(
      `Checking for comments on $$type since: ${LoggerService.cyan(sinceDate)}`
    );

    if (!sinceDate) {
      return true;
    }

    // find any comments since the date
    const comments = await this.listIssueComments(issue, sinceDate);

    const filteredComments = comments.filter(
      comment =>
        comment.user?.type === 'User' &&
        comment.body?.toLowerCase() !== staleMessage.toLowerCase()
    );

    issueLogger.info(
      `Comments that are not the stale comment or another bot: ${LoggerService.cyan(
        filteredComments.length
      )}`
    );

    // if there are any user comments returned
    return filteredComments.length > 0;
  }

  // Mark an issue as stale with a comment and a label
  private async _markStale(
    issue: Issue,
    staleMessage: string,
    staleLabel: string,
    skipMessage: boolean
  ): Promise<void> {
    const issueLogger: IssueLogger = new IssueLogger(issue);

    issueLogger.info(`Marking this $$type as stale`);
    this.staleIssues.push(issue);

    // if the issue is being marked stale, the updated date should be changed to right now
    // so that close calculations work correctly
    const newUpdatedAtDate: Date = new Date();
    issue.updated_at = newUpdatedAtDate.toString();

    if (!skipMessage) {
      try {
        this._consumeIssueOperation(issue);
        this.statistics?.incrementAddedItemsComment(issue);

        if (!this.options.debugOnly) {
          await this.client.rest.issues.createComment({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: issue.number,
            body: staleMessage
          });
        }
      } catch (error) {
        issueLogger.error(`Error when creating a comment: ${error.message}`);
      }
    }

    try {
      this._consumeIssueOperation(issue);
      this.statistics?.incrementAddedItemsLabel(issue);
      this.statistics?.incrementStaleItemsCount(issue);

      if (!this.options.debugOnly) {
        await this.client.rest.issues.addLabels({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: issue.number,
          labels: [staleLabel]
        });
      }
    } catch (error) {
      issueLogger.error(`Error when adding a label: ${error.message}`);
    }
  }

  // Close an issue based on staleness
  private async _closeIssue(
    issue: Issue,
    closeMessage?: string,
    closeLabel?: string
  ): Promise<void> {
    const issueLogger: IssueLogger = new IssueLogger(issue);

    issueLogger.info(`Closing $$type for being stale`);
    this.closedIssues.push(issue);

    if (closeMessage) {
      try {
        this._consumeIssueOperation(issue);
        this.statistics?.incrementAddedItemsComment(issue);
        this.addedCloseCommentIssues.push(issue);

        if (!this.options.debugOnly) {
          await this.client.rest.issues.createComment({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: issue.number,
            body: closeMessage
          });
        }
      } catch (error) {
        issueLogger.error(`Error when creating a comment: ${error.message}`);
      }
    }

    if (closeLabel) {
      try {
        this._consumeIssueOperation(issue);
        this.statistics?.incrementAddedItemsLabel(issue);

        if (!this.options.debugOnly) {
          await this.client.rest.issues.addLabels({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: issue.number,
            labels: [closeLabel]
          });
        }
      } catch (error) {
        issueLogger.error(`Error when adding a label: ${error.message}`);
      }
    }

    try {
      this._consumeIssueOperation(issue);
      this.statistics?.incrementClosedItemsCount(issue);

      if (!this.options.debugOnly) {
        await this.client.rest.issues.update({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: issue.number,
          state: 'closed'
        });
      }
    } catch (error) {
      issueLogger.error(`Error when updating this $$type: ${error.message}`);
    }
  }

  // Delete the branch on closed pull request
  private async _deleteBranch(issue: Issue): Promise<void> {
    const issueLogger: IssueLogger = new IssueLogger(issue);

    issueLogger.info(`Delete
    branch from closed $
    $type
    -
    ${issue.title}`);

    const pullRequest: IPullRequest | undefined | void =
      await this.getPullRequest(issue);

    if (!pullRequest) {
      issueLogger.info(
        `Not deleting this branch as no pull request was found for this $$type`
      );
      return;
    }

    const branch = pullRequest.head.ref;
    issueLogger.info(
      `Deleting the branch "${LoggerService.cyan(branch)}" from closed $$type`
    );

    try {
      this._consumeIssueOperation(issue);
      this.statistics?.incrementDeletedBranchesCount();

      if (!this.options.debugOnly) {
        await this.client.rest.git.deleteRef({
          owner: context.repo.owner,
          repo: context.repo.repo,
          ref: `heads/${branch}`
        });
      }
    } catch (error) {
      issueLogger.error(
        `Error when deleting the branch "${LoggerService.cyan(
          branch
        )}" from $$type: ${error.message}`
      );
    }
  }

  // Remove a label from an issue or a pull request
  private async _removeLabel(
    issue: Issue,
    label: string,
    isSubStep: Readonly<boolean> = false
  ): Promise<void> {
    const issueLogger: IssueLogger = new IssueLogger(issue);

    issueLogger.info(
      `${
        isSubStep ? LoggerService.white('├── ') : ''
      }Removing the label "${LoggerService.cyan(label)}" from this $$type...`
    );
    this.removedLabelIssues.push(issue);

    try {
      this._consumeIssueOperation(issue);
      this.statistics?.incrementDeletedItemsLabelsCount(issue);

      if (!this.options.debugOnly) {
        await this.client.rest.issues.removeLabel({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: issue.number,
          name: label
        });
      }

      issueLogger.info(
        `${
          isSubStep ? LoggerService.white('└── ') : ''
        }The label "${LoggerService.cyan(label)}" was removed`
      );
    } catch (error) {
      issueLogger.error(
        `${
          isSubStep ? LoggerService.white('└── ') : ''
        }Error when removing the label: "${LoggerService.cyan(error.message)}"`
      );
    }
  }

  private _getDaysBeforeIssueStale(): number {
    return isNaN(this.options.daysBeforeIssueStale)
      ? this.options.daysBeforeStale
      : this.options.daysBeforeIssueStale;
  }

  private _getDaysBeforePrStale(): number {
    return isNaN(this.options.daysBeforePrStale)
      ? this.options.daysBeforeStale
      : this.options.daysBeforePrStale;
  }

  private _getDaysBeforeIssueClose(): number {
    return isNaN(this.options.daysBeforeIssueClose)
      ? this.options.daysBeforeClose
      : this.options.daysBeforeIssueClose;
  }

  private _getDaysBeforePrClose(): number {
    return isNaN(this.options.daysBeforePrClose)
      ? this.options.daysBeforeClose
      : this.options.daysBeforePrClose;
  }

  private _getOnlyLabels(issue: Issue): string {
    if (issue.isPullRequest) {
      if (this.options.onlyPrLabels !== '') {
        return this.options.onlyPrLabels;
      }
    } else {
      if (this.options.onlyIssueLabels !== '') {
        return this.options.onlyIssueLabels;
      }
    }

    return this.options.onlyLabels;
  }

  private _getAnyOfLabels(issue: Issue): string {
    if (issue.isPullRequest) {
      if (this.options.anyOfPrLabels !== '') {
        return this.options.anyOfPrLabels;
      }
    } else {
      if (this.options.anyOfIssueLabels !== '') {
        return this.options.anyOfIssueLabels;
      }
    }

    return this.options.anyOfLabels;
  }

  private _shouldRemoveStaleWhenUpdated(issue: Issue): boolean {
    if (issue.isPullRequest) {
      if (isBoolean(this.options.removePrStaleWhenUpdated)) {
        return this.options.removePrStaleWhenUpdated;
      }

      return this.options.removeStaleWhenUpdated;
    }

    if (isBoolean(this.options.removeIssueStaleWhenUpdated)) {
      return this.options.removeIssueStaleWhenUpdated;
    }

    return this.options.removeStaleWhenUpdated;
  }

  private async _removeLabelsWhenUnstale(
    issue: Issue,
    removeLabels: Readonly<string>[]
  ): Promise<void> {
    if (!removeLabels.length) {
      return;
    }

    const issueLogger: IssueLogger = new IssueLogger(issue);

    issueLogger.info(
      `Removing all the labels specified via the ${this._logger.createOptionLink(
        Option.LabelsToRemoveWhenUnstale
      )} option.`
    );

    for (const label of removeLabels.values()) {
      await this._removeLabel(issue, label);
    }
  }

  private async _addLabelsWhenUnstale(
    issue: Issue,
    labelsToAdd: Readonly<string>[]
  ): Promise<void> {
    if (!labelsToAdd.length) {
      return;
    }

    const issueLogger: IssueLogger = new IssueLogger(issue);

    issueLogger.info(
      `Adding all the labels specified via the ${this._logger.createOptionLink(
        Option.LabelsToAddWhenUnstale
      )} option.`
    );

    this.addedLabelIssues.push(issue);

    try {
      this._consumeIssueOperation(issue);
      this.statistics?.incrementAddedItemsLabel(issue);
      if (!this.options.debugOnly) {
        await this.client.rest.issues.addLabels({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: issue.number,
          labels: labelsToAdd
        });
      }
    } catch (error) {
      this._logger.error(
        `Error when adding labels after updated from stale: ${error.message}`
      );
    }
  }

  private async _removeStaleLabel(
    issue: Issue,
    staleLabel: Readonly<string>
  ): Promise<void> {
    const issueLogger: IssueLogger = new IssueLogger(issue);

    issueLogger.info(
      `The $$type is no longer stale. Removing the stale label...`
    );

    await this._removeLabel(issue, staleLabel);
    this.statistics?.incrementUndoStaleItemsCount(issue);
  }

  private async _removeCloseLabel(
    issue: Issue,
    closeLabel: Readonly<string | undefined>
  ): Promise<void> {
    const issueLogger: IssueLogger = new IssueLogger(issue);

    issueLogger.info(
      `The $$type is not closed nor locked. Trying to remove the close label...`
    );

    if (!closeLabel) {
      issueLogger.info(
        LoggerService.white('├──'),
        `The ${issueLogger.createOptionLink(
          IssuesProcessor._getCloseLabelUsedOptionName(issue)
        )} option was not set`
      );
      issueLogger.info(
        LoggerService.white('└──'),
        `Skipping the removal of the close label`
      );

      return Promise.resolve();
    }

    if (isLabeled(issue, closeLabel)) {
      issueLogger.info(
        LoggerService.white('├──'),
        `The $$type has a close label "${LoggerService.cyan(
          closeLabel
        )}". Removing the close label...`
      );

      await this._removeLabel(issue, closeLabel, true);
      this.statistics?.incrementDeletedCloseItemsLabelsCount(issue);
    } else {
      issueLogger.info(
        LoggerService.white('└──'),
        `There is no close label on this $$type. Skipping`
      );

      return Promise.resolve();
    }
  }

  private _consumeIssueOperation(issue: Readonly<Issue>): void {
    this.operations.consumeOperation();
    issue.operations.consumeOperation();
  }

  private _getDaysBeforeStaleUsedOptionName(
    issue: Readonly<Issue>
  ):
    | Option.DaysBeforeStale
    | Option.DaysBeforeIssueStale
    | Option.DaysBeforePrStale {
    return issue.isPullRequest
      ? this._getDaysBeforePrStaleUsedOptionName()
      : this._getDaysBeforeIssueStaleUsedOptionName();
  }

  private _getDaysBeforeIssueStaleUsedOptionName():
    | Option.DaysBeforeStale
    | Option.DaysBeforeIssueStale {
    return isNaN(this.options.daysBeforeIssueStale)
      ? Option.DaysBeforeStale
      : Option.DaysBeforeIssueStale;
  }

  private _getDaysBeforePrStaleUsedOptionName():
    | Option.DaysBeforeStale
    | Option.DaysBeforePrStale {
    return isNaN(this.options.daysBeforePrStale)
      ? Option.DaysBeforeStale
      : Option.DaysBeforePrStale;
  }

  private _getRemoveStaleWhenUpdatedUsedOptionName(
    issue: Readonly<Issue>
  ):
    | Option.RemovePrStaleWhenUpdated
    | Option.RemoveStaleWhenUpdated
    | Option.RemoveIssueStaleWhenUpdated {
    if (issue.isPullRequest) {
      if (isBoolean(this.options.removePrStaleWhenUpdated)) {
        return Option.RemovePrStaleWhenUpdated;
      }

      return Option.RemoveStaleWhenUpdated;
    }

    if (isBoolean(this.options.removeIssueStaleWhenUpdated)) {
      return Option.RemoveIssueStaleWhenUpdated;
    }

    return Option.RemoveStaleWhenUpdated;
  }
}
