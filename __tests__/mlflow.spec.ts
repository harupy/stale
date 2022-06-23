import {Issue} from '../src/classes/issue';
import {IUser} from '../src/interfaces/user';
import {IIssuesProcessorOptions} from '../src/interfaces/issues-processor-options';
import {IsoDateString} from '../src/types/iso-date-string';
import {IssuesProcessorMock} from './classes/issues-processor-mock';
import {DefaultProcessorOptions} from './constants/default-processor-options';
import {generateIssue as _generateIssue} from './functions/generate-issue';

function getDaysAgoTimestamp(
  numOfDays: number,
  date: Date = new Date()
): IsoDateString {
  const daysAgo = new Date(date.getTime());
  daysAgo.setDate(date.getDate() - numOfDays);
  const withoutMilliseconds = daysAgo.toISOString().split('.')[0];
  return `${withoutMilliseconds}Z`;
}
const today = getDaysAgoTimestamp(0);

function getIssues(issues: Issue[]): (page: number) => Promise<Issue[]> {
  return async (page: number) => issues.slice((page - 1) * 100, page * 100);
}

type GenerateIssueParameters = {
  options: IIssuesProcessorOptions;
  id?: number;
  title?: string;
  updatedAt?: IsoDateString;
  createdAt?: IsoDateString;
  isPullRequest?: boolean;
  labels?: string[];
  isClosed?: boolean;
  isLocked?: boolean;
  milestone?: string;
  assignees?: string[];
  user?: IUser;
};

function generateIssue({
  options,
  id = 1,
  title = 'Issue',
  updatedAt = today,
  createdAt = today,
  isPullRequest = false,
  labels = [],
  isClosed = false,
  isLocked = false,
  milestone = undefined,
  assignees = [],
  user = undefined
}: GenerateIssueParameters): Issue {
  return _generateIssue(
    options,
    id,
    title,
    updatedAt,
    createdAt,
    isPullRequest,
    labels,
    isClosed,
    isLocked,
    milestone,
    assignees,
    user
  );
}

test('Remind maintainers to assign a maintainer when an issue has no assignees and comments', async () => {
  const options = {
    ...DefaultProcessorOptions,
    mlflow: true
  };
  const issues: Issue[] = [
    generateIssue({
      options,
      updatedAt: getDaysAgoTimestamp(8),
      createdAt: getDaysAgoTimestamp(8),
      assignees: ['non-maintainer']
    })
  ];
  const processor = new IssuesProcessorMock(
    options,
    getIssues(issues),
    async () => [],
    async () => new Date().toDateString(),
    undefined,
    async () => ['maintainer']
  );
  await processor.setMaintainers();
  const createCommentSpy = jest.spyOn(processor, 'createComment');
  await processor.processIssues(1);

  expect(createCommentSpy).toHaveBeenCalledTimes(1);
  expect(createCommentSpy).toHaveBeenCalledWith(
    expect.anything(),
    'Reminder to MLflow maintainers. Please assign a maintainer to this issue and start triaging.'
  );
});

test('Remind maintainers to reply when the last comment was posted by a non-maintainer user', async () => {
  const options = {
    ...DefaultProcessorOptions,

    mlflow: true
  };
  const issues: Issue[] = [
    generateIssue({
      options,
      updatedAt: getDaysAgoTimestamp(15),
      createdAt: getDaysAgoTimestamp(15),
      assignees: ['non-maintainer']
    })
  ];
  const processor = new IssuesProcessorMock(
    options,
    getIssues(issues),
    async () => [
      {
        user: {
          login: 'non-maintainer',
          type: 'User'
        },
        body: 'comment',
        created_at: getDaysAgoTimestamp(15)
      }
    ],
    async () => new Date().toDateString(),
    undefined,
    async () => ['maintainer']
  );
  await processor.setMaintainers();

  const createCommentSpy = jest.spyOn(processor, 'createComment');
  await processor.processIssues(1);

  expect(createCommentSpy).toHaveBeenCalledTimes(1);
  expect(createCommentSpy).toHaveBeenCalledWith(
    expect.anything(),
    'Reminder to MLflow maintainers. Please reply to comments.'
  );
});

test('Remind issue author to reply when the last comment was posted by a maintainer user', async () => {
  const options = {
    ...DefaultProcessorOptions,

    mlflow: true
  };
  const issues: Issue[] = [
    generateIssue({
      options,
      updatedAt: getDaysAgoTimestamp(15),
      createdAt: getDaysAgoTimestamp(15),
      assignees: ['non-maintainer'],
      user: {
        login: 'non-maintainer',
        type: 'User'
      }
    })
  ];
  const processor = new IssuesProcessorMock(
    options,
    getIssues(issues),
    async () => [
      {
        user: {
          login: 'maintainer',
          type: 'User'
        },
        body: 'comment',
        created_at: getDaysAgoTimestamp(15)
      }
    ],
    async () => new Date().toDateString(),
    undefined,
    async () => ['maintainer']
  );
  await processor.setMaintainers();
  const createCommentSpy = jest.spyOn(processor, 'createComment');
  await processor.processIssues(1);

  expect(createCommentSpy).toHaveBeenCalledTimes(1);
  expect(createCommentSpy).toHaveBeenCalledWith(
    expect.anything(),
    '@non-maintainer Any updates here?'
  );
});

test('Ignore comments posted by a bot', async () => {
  const options = {
    ...DefaultProcessorOptions,
    mlflow: true
  };
  const issues: Issue[] = [
    generateIssue({
      options,
      updatedAt: getDaysAgoTimestamp(15),
      createdAt: getDaysAgoTimestamp(15)
    })
  ];
  const processor = new IssuesProcessorMock(
    options,
    getIssues(issues),
    async () => [
      {
        user: {
          login: 'bot',
          type: 'Bot'
        },
        body: 'comment',
        created_at: getDaysAgoTimestamp(15)
      }
    ],
    async () => new Date().toDateString(),
    undefined,
    async () => ['maintainer']
  );
  await processor.setMaintainers();

  const createCommentSpy = jest.spyOn(processor, 'createComment');
  await processor.processIssues(1);

  expect(createCommentSpy).not.toHaveBeenCalled();
});

test('Ignore issues that have a has-closing-pr label', async () => {
  const options = {
    ...DefaultProcessorOptions,
    mlflow: true
  };
  const issues: Issue[] = [
    generateIssue({
      options,
      updatedAt: getDaysAgoTimestamp(15),
      createdAt: getDaysAgoTimestamp(15),
      labels: ['has-closing-pr']
    })
  ];
  const processor = new IssuesProcessorMock(
    options,
    getIssues(issues),
    async () => [],
    async () => new Date().toDateString()
  );
  await processor.setMaintainers();

  const createCommentSpy = jest.spyOn(processor, 'createComment');
  await processor.processIssues(1);

  expect(createCommentSpy).not.toHaveBeenCalled();
});

test('Ignore stale issues', async () => {
  const options = {
    ...DefaultProcessorOptions,
    mlflow: true
  };
  const issues: Issue[] = [
    generateIssue({
      options,
      updatedAt: getDaysAgoTimestamp(15),
      createdAt: getDaysAgoTimestamp(15),
      labels: ['Stale']
    })
  ];
  const processor = new IssuesProcessorMock(
    options,
    getIssues(issues),
    async () => [],
    async () => new Date().toDateString()
  );
  await processor.setMaintainers();

  const createCommentSpy = jest.spyOn(processor, 'createComment');
  await processor.processIssues(1);

  expect(createCommentSpy).not.toHaveBeenCalled();
});

test('Ignore issues created before start-date', async () => {
  const options = {
    ...DefaultProcessorOptions,
    mlflow: true,
    startDate: today
  };
  const issues: Issue[] = [
    generateIssue({
      options,
      updatedAt: getDaysAgoTimestamp(15),
      createdAt: getDaysAgoTimestamp(15)
    })
  ];
  const processor = new IssuesProcessorMock(
    options,
    getIssues(issues),
    async () => [],
    async () => new Date().toDateString()
  );
  await processor.setMaintainers();

  const createCommentSpy = jest.spyOn(processor, 'createComment');
  await processor.processIssues(1);

  expect(createCommentSpy).not.toHaveBeenCalled();
});

test('Ignore issues in milestones', async () => {
  const options = {
    ...DefaultProcessorOptions,
    mlflow: true
  };
  const issues: Issue[] = [
    generateIssue({
      options,
      updatedAt: getDaysAgoTimestamp(15),
      createdAt: getDaysAgoTimestamp(15),
      milestone: 'milestone'
    })
  ];
  const processor = new IssuesProcessorMock(
    options,
    getIssues(issues),
    async () => [],
    async () => new Date().toDateString()
  );
  await processor.setMaintainers();

  const createCommentSpy = jest.spyOn(processor, 'createComment');
  await processor.processIssues(1);

  expect(createCommentSpy).not.toHaveBeenCalled();
});
