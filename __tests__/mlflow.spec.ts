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
): string {
  const daysAgo = new Date(date.getTime());
  daysAgo.setDate(date.getDate() - numOfDays);
  const withoutMilliseconds = daysAgo.toISOString().split('.')[0];
  return `${withoutMilliseconds}Z`;
}

type GenerateIssueParameters = {
  options: IIssuesProcessorOptions;
  id: number;
  title: string;
  updatedAt: IsoDateString;
  createdAt: IsoDateString;
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
  id,
  title,
  updatedAt,
  createdAt,
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
    removeStaleWhenUpdated: true,
    mlflow: true
  };
  const TestIssueList: Issue[] = [
    generateIssue({
      options,
      id: 1,
      title: 'Issue',
      updatedAt: getDaysAgoTimestamp(8),
      createdAt: getDaysAgoTimestamp(8),
      assignees: ['non-maintainer']
    })
  ];
  const processor = new IssuesProcessorMock(
    options,
    async p => (p === 1 ? TestIssueList : []),
    async () => [],
    async () => new Date().toDateString(),
    undefined,
    async () => ['maintainer']
  );
  processor.init();
  const createCommentSpy = jest
    .spyOn(processor as any, 'createComment')
    .mockImplementation(() => {});
  await processor.processIssues(1);

  expect(createCommentSpy).toHaveBeenCalledWith(
    expect.anything(),
    'Reminder to MLflow maintainers. Please assign a maintainer to this issue and start triaging.'
  );
});

test('Remind maintainers to reply when the last comment was posted by a non-maintainer user', async () => {
  const options = {
    ...DefaultProcessorOptions,
    removeStaleWhenUpdated: true,
    mlflow: true
  };
  const TestIssueList: Issue[] = [
    generateIssue({
      options,
      id: 1,
      title: 'Issue',
      updatedAt: getDaysAgoTimestamp(15),
      createdAt: getDaysAgoTimestamp(15),
      assignees: ['non-maintainer']
    })
  ];
  const processor = new IssuesProcessorMock(
    options,
    async p => (p === 1 ? TestIssueList : []),
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
  processor.init();

  const createCommentSpy = jest
    .spyOn(processor as any, 'createComment')
    .mockImplementation(() => {});

  // process our fake issue list
  await processor.processIssues(1);

  expect(createCommentSpy).toHaveBeenCalledWith(
    expect.anything(),
    'Reminder to MLflow maintainers. Please reply to comments.'
  );
});

test('Remind issue author to reply when the last comment was posted by a maintainer user', async () => {
  const options = {
    ...DefaultProcessorOptions,
    removeStaleWhenUpdated: true,
    mlflow: true
  };
  const TestIssueList: Issue[] = [
    generateIssue({
      options,
      id: 1,
      title: 'Issue',
      updatedAt: getDaysAgoTimestamp(15),
      createdAt: getDaysAgoTimestamp(15),
      assignees: ['non-maintainer'],
      user: {login: 'non-maintainer', type: 'User'}
    })
  ];
  const processor = new IssuesProcessorMock(
    options,
    async p => (p === 1 ? TestIssueList : []),
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
  processor.init();
  const createCommentSpy = jest
    .spyOn(processor as any, 'createComment')
    .mockImplementation(() => {});
  await processor.processIssues(1);

  expect(createCommentSpy).toHaveBeenCalledWith(
    expect.anything(),
    '@non-maintainer Any updates here?'
  );
});

test('Ignore comments posted by a bot', async () => {
  const options = {
    ...DefaultProcessorOptions,
    removeStaleWhenUpdated: true,
    mlflow: true
  };
  const TestIssueList: Issue[] = [
    generateIssue({
      options,
      id: 1,
      title: 'Issue',
      updatedAt: getDaysAgoTimestamp(15),
      createdAt: getDaysAgoTimestamp(15)
    })
  ];
  const processor = new IssuesProcessorMock(
    options,
    async p => (p === 1 ? TestIssueList : []),
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
  processor.init();

  const createCommentSpy = jest
    .spyOn(processor as any, 'createComment')
    .mockImplementation(() => {});
  await processor.processIssues(1);

  expect(createCommentSpy).not.toHaveBeenCalled();
});

test('Ignore issues that have a has-closing-pr label', async () => {
  const options = {
    ...DefaultProcessorOptions,
    removeStaleWhenUpdated: true,
    mlflow: true
  };
  const TestIssueList: Issue[] = [
    generateIssue({
      options,
      id: 1,
      title: 'Issue',
      updatedAt: getDaysAgoTimestamp(15),
      createdAt: getDaysAgoTimestamp(15),
      labels: ['has-closing-pr']
    })
  ];
  const processor = new IssuesProcessorMock(
    options,
    async p => (p === 1 ? TestIssueList : []),
    async () => [],
    async () => new Date().toDateString()
  );
  processor.init();

  const createCommentSpy = jest
    .spyOn(processor as any, 'createComment')
    .mockImplementation(() => {});
  await processor.processIssues(1);

  expect(createCommentSpy).not.toHaveBeenCalled();
});

test('Ignore stale issues', async () => {
  const options = {
    ...DefaultProcessorOptions,
    removeStaleWhenUpdated: true,
    mlflow: true
  };
  const TestIssueList: Issue[] = [
    generateIssue({
      options,
      id: 1,
      title: 'Issue',
      updatedAt: getDaysAgoTimestamp(15),
      createdAt: getDaysAgoTimestamp(15),
      labels: ['stale']
    })
  ];
  const processor = new IssuesProcessorMock(
    options,
    async p => (p === 1 ? TestIssueList : []),
    async () => [],
    async () => new Date().toDateString()
  );
  processor.init();

  const createCommentSpy = jest
    .spyOn(processor as any, 'createComment')
    .mockImplementation(() => {});
  await processor.processIssues(1);

  expect(createCommentSpy).not.toHaveBeenCalled();
});

test('Ignore issues created before start-date', async () => {
  const options = {
    ...DefaultProcessorOptions,
    removeStaleWhenUpdated: true,
    mlflow: true,
    startDate: getDaysAgoTimestamp(0)
  };
  const TestIssueList: Issue[] = [
    generateIssue({
      options,
      id: 1,
      title: 'Issue',
      updatedAt: getDaysAgoTimestamp(15),
      createdAt: getDaysAgoTimestamp(15),
      labels: ['stale']
    })
  ];
  const processor = new IssuesProcessorMock(
    options,
    async p => (p === 1 ? TestIssueList : []),
    async () => [],
    async () => new Date().toDateString()
  );
  processor.init();

  const createCommentSpy = jest
    .spyOn(processor as any, 'createComment')
    .mockImplementation(() => {});
  await processor.processIssues(1);

  expect(createCommentSpy).not.toHaveBeenCalled();
});
