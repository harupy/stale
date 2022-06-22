import {Issue} from '../src/classes/issue';
import {IssuesProcessorMock} from './classes/issues-processor-mock';
import {DefaultProcessorOptions} from './constants/default-processor-options';
import {generateIssue} from './functions/generate-issue';

function getDaysAgoTimestamp(
  numOfDays: number,
  date: Date = new Date()
): string {
  const daysAgo = new Date(date.getTime());
  daysAgo.setDate(date.getDate() - numOfDays);
  const withoutMilliseconds = daysAgo.toISOString().split('.')[0];
  return `${withoutMilliseconds}Z`;
}

test('Ask maintainers to assign a maintainer when an issue has no assignees and comments', async () => {
  const opts = {
    ...DefaultProcessorOptions,
    removeStaleWhenUpdated: true,
    mlflow: true
  };
  const TestIssueList: Issue[] = [
    generateIssue(
      opts,
      1,
      'An issue that has no assignees and no comments',
      getDaysAgoTimestamp(8),
      getDaysAgoTimestamp(8),
      false,
      [],
      false,
      false,
      undefined,
      ['non-maintainer']
    )
  ];
  const processor = new IssuesProcessorMock(
    opts,
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

test('Ask maintainers to reply when the last comment was posted by a non-maintainer user', async () => {
  const opts = {
    ...DefaultProcessorOptions,
    removeStaleWhenUpdated: true,
    mlflow: true
  };
  const TestIssueList: Issue[] = [
    generateIssue(
      opts,
      1,
      'An issue with a comment',
      getDaysAgoTimestamp(15),
      getDaysAgoTimestamp(15),
      false,
      [],
      false,
      false,
      undefined,
      ['non-maintainer']
    )
  ];
  const processor = new IssuesProcessorMock(
    opts,
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

test('Ask the issue author to reply when the last comment was posted by a maintainer user', async () => {
  const opts = {
    ...DefaultProcessorOptions,
    removeStaleWhenUpdated: true,
    mlflow: true
  };
  const TestIssueList: Issue[] = [
    generateIssue(
      opts,
      1,
      'An issue with a comment',
      getDaysAgoTimestamp(15),
      getDaysAgoTimestamp(15),
      false,
      [],
      false,
      false,
      undefined,
      ['non-maintainer'],
      {login: 'non-maintainer', type: 'User'}
    )
  ];
  const processor = new IssuesProcessorMock(
    opts,
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
  const opts = {
    ...DefaultProcessorOptions,
    removeStaleWhenUpdated: true,
    mlflow: true
  };
  const TestIssueList: Issue[] = [
    generateIssue(
      opts,
      1,
      'An issue with a comment',
      getDaysAgoTimestamp(15),
      getDaysAgoTimestamp(15),
      false,
      [],
      false,
      false,
      undefined,
      ['non-maintainer'],
      {login: 'non-maintainer', type: 'User'}
    )
  ];
  const processor = new IssuesProcessorMock(
    opts,
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
  const opts = {
    ...DefaultProcessorOptions,
    removeStaleWhenUpdated: true,
    mlflow: true
  };
  const TestIssueList: Issue[] = [
    generateIssue(
      opts,
      1,
      'An issue with a comment',
      getDaysAgoTimestamp(15),
      getDaysAgoTimestamp(15),
      false,
      ['has-closing-pr'],
      false,
      false,
      undefined,
      ['non-maintainer'],
      {login: 'non-maintainer', type: 'User'}
    )
  ];
  const processor = new IssuesProcessorMock(
    opts,
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

  expect(createCommentSpy).not.toHaveBeenCalled();
});

test('Ignore stale issues', async () => {
  const opts = {
    ...DefaultProcessorOptions,
    removeStaleWhenUpdated: true,
    mlflow: true
  };
  const TestIssueList: Issue[] = [
    generateIssue(
      opts,
      1,
      'An issue with a comment',
      getDaysAgoTimestamp(15),
      getDaysAgoTimestamp(15),
      false,
      ['stale']
    )
  ];
  const processor = new IssuesProcessorMock(
    opts,
    async p => (p === 1 ? TestIssueList : []),
    async () => [],
    async () => new Date().toDateString(),
    undefined,
    async () => []
  );
  processor.init();

  const createCommentSpy = jest
    .spyOn(processor as any, 'createComment')
    .mockImplementation(() => {});
  await processor.processIssues(1);

  expect(createCommentSpy).not.toHaveBeenCalled();
});

test('Ignore issues created before start-date', async () => {
  const opts = {
    ...DefaultProcessorOptions,
    removeStaleWhenUpdated: true,
    mlflow: true,
    startDate: getDaysAgoTimestamp(0)
  };
  const TestIssueList: Issue[] = [
    generateIssue(
      opts,
      1,
      'An issue with a comment',
      getDaysAgoTimestamp(15),
      getDaysAgoTimestamp(15)
    )
  ];
  const processor = new IssuesProcessorMock(
    opts,
    async p => (p === 1 ? TestIssueList : []),
    async () => [],
    async () => new Date().toDateString(),
    undefined,
    async () => []
  );
  processor.init();

  const createCommentSpy = jest
    .spyOn(processor as any, 'createComment')
    .mockImplementation(() => {});
  await processor.processIssues(1);

  expect(createCommentSpy).not.toHaveBeenCalled();
});
