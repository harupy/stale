import {Issue} from '../src/classes/issue';
import {IUser} from '../src/interfaces/user';
import {IIssuesProcessorOptions} from '../src/interfaces/issues-processor-options';
import {IsoDateString} from '../src/types/iso-date-string';
import {IssuesProcessorMock} from './classes/issues-processor-mock';
import {IPullRequest} from '../src/interfaces/pull-request';
import {IComment} from '../src/interfaces/comment';

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

function createGetIssues(issues: Issue[]): (page: number) => Promise<Issue[]> {
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

const generateIssue = ({
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
}: GenerateIssueParameters): Issue => {
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
};

const MAINTAINER = 'maintainer';
const NON_MAINTAINER = 'non-maintainer';

type CreateIssueProcessorMockParameters = {
  options: IIssuesProcessorOptions;
  getIssues: (page: number) => Promise<Issue[]>;
  listIssueComments?: (issue: Issue, sinceDate: string) => Promise<IComment[]>;
  getLabelCreationDate?: (
    issue: Issue,
    label: string
  ) => Promise<string | undefined>;
  getPullRequest?: (issue: Issue) => Promise<IPullRequest | undefined | void>;
  getMaintainers?: () => Promise<string[]>;
};

const createIssueProcessorMock = ({
  options,
  getIssues,
  listIssueComments = async () => [],
  getLabelCreationDate = async () => new Date().toDateString(),
  getPullRequest = undefined,
  getMaintainers = async () => [MAINTAINER]
}: CreateIssueProcessorMockParameters): IssuesProcessorMock =>
  new IssuesProcessorMock(
    options,
    getIssues,
    listIssueComments,
    getLabelCreationDate,
    getPullRequest,
    getMaintainers
  );

test('Remind maintainers to assign a maintainer when an issue has no maintainer assignees', async () => {
  const options = {
    ...DefaultProcessorOptions,
    mlflow: true
  };
  const issues: Issue[] = [
    generateIssue({
      options,
      updatedAt: getDaysAgoTimestamp(8),
      createdAt: getDaysAgoTimestamp(8),
      assignees: [NON_MAINTAINER]
    })
  ];
  const processor = createIssueProcessorMock({
    options,
    getIssues: createGetIssues(issues)
  });
  await processor.setMaintainers();
  const createCommentSpy = jest.spyOn(processor, 'createComment');
  await processor.processIssues(1);

  expect(createCommentSpy).toHaveBeenCalledTimes(1);
  expect(createCommentSpy).toHaveBeenCalledWith(
    expect.anything(),
    expect.stringContaining(
      'Please assign a maintainer and start triaging this issue.'
    )
  );
});

test('Remind maintainers to reply when last comment was posted by non-maintainer', async () => {
  const options = {
    ...DefaultProcessorOptions,
    mlflow: true
  };
  const issues: Issue[] = [
    generateIssue({
      options,
      updatedAt: getDaysAgoTimestamp(15),
      createdAt: getDaysAgoTimestamp(15),
      assignees: [MAINTAINER]
    })
  ];
  const processor = createIssueProcessorMock({
    options,
    getIssues: createGetIssues(issues),
    listIssueComments: async () => [
      {
        user: {
          login: 'non-maintainer',
          type: 'User'
        },
        body: 'comment',
        created_at: getDaysAgoTimestamp(15)
      }
    ]
  });
  await processor.setMaintainers();
  const createCommentSpy = jest.spyOn(processor, 'createComment');
  await processor.processIssues(1);

  expect(createCommentSpy).toHaveBeenCalledTimes(1);
  expect(createCommentSpy).toHaveBeenCalledWith(
    expect.anything(),
    expect.stringContaining('Please reply to comments.')
  );
});

test('Remind issue author to reply when last comment was posted by maintainer', async () => {
  const options = {
    ...DefaultProcessorOptions,
    mlflow: true
  };
  const issues: Issue[] = [
    generateIssue({
      options,
      updatedAt: getDaysAgoTimestamp(15),
      createdAt: getDaysAgoTimestamp(15),
      assignees: [MAINTAINER],
      user: {
        login: NON_MAINTAINER,
        type: 'User'
      }
    })
  ];
  const processor = createIssueProcessorMock({
    options,
    getIssues: createGetIssues(issues),
    listIssueComments: async () => [
      {
        user: {
          login: MAINTAINER,
          type: 'User'
        },
        body: 'comment',
        created_at: getDaysAgoTimestamp(15)
      }
    ]
  });
  await processor.setMaintainers();
  const createCommentSpy = jest.spyOn(processor, 'createComment');
  await processor.processIssues(1);

  expect(createCommentSpy).toHaveBeenCalledTimes(1);
  expect(createCommentSpy).toHaveBeenCalledWith(
    expect.anything(),
    expect.stringContaining('@non-maintainer Any updates here?')
  );
});

test('Skip processing issue if last comment was posted by bot', async () => {
  const options = {
    ...DefaultProcessorOptions,
    mlflow: true
  };
  const issues: Issue[] = [
    generateIssue({
      options,
      updatedAt: getDaysAgoTimestamp(15),
      createdAt: getDaysAgoTimestamp(15),
      assignees: [MAINTAINER]
    })
  ];
  const processor = createIssueProcessorMock({
    options,
    getIssues: createGetIssues(issues),
    listIssueComments: async () => [
      {
        user: {
          login: 'bot',
          type: 'Bot'
        },
        body: 'comment',
        created_at: getDaysAgoTimestamp(15)
      }
    ]
  });
  await processor.setMaintainers();
  const createCommentSpy = jest.spyOn(processor, 'createComment');
  await processor.processIssues(1);

  expect(createCommentSpy).not.toHaveBeenCalled();
});

test('Ignore issue that is triaged and has has-closing-pr label', async () => {
  const options = {
    ...DefaultProcessorOptions,
    mlflow: true
  };
  const issues: Issue[] = [
    generateIssue({
      options,
      updatedAt: getDaysAgoTimestamp(15),
      createdAt: getDaysAgoTimestamp(15),
      labels: ['has-closing-pr'],
      assignees: ['maintainer']
    })
  ];

  const processor = createIssueProcessorMock({
    options,
    getIssues: createGetIssues(issues),
    listIssueComments: async () => [
      {
        user: {
          login: MAINTAINER,
          type: 'User'
        },
        body: 'Thanks for filing the PR!',
        created_at: getDaysAgoTimestamp(15)
      }
    ]
  });
  await processor.setMaintainers();
  const createCommentSpy = jest.spyOn(processor, 'createComment');
  await processor.processIssues(1);

  expect(createCommentSpy).not.toHaveBeenCalled();
});

test('Ignore stale issue', async () => {
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

  const processor = createIssueProcessorMock({
    options,
    getIssues: createGetIssues(issues)
  });
  await processor.setMaintainers();
  const createCommentSpy = jest.spyOn(processor, 'createComment');
  await processor.processIssues(1);

  expect(createCommentSpy).not.toHaveBeenCalled();
});

test('Ignore issue created before start-date', async () => {
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
  const processor = createIssueProcessorMock({
    options,
    getIssues: createGetIssues(issues)
  });
  await processor.setMaintainers();

  const createCommentSpy = jest.spyOn(processor, 'createComment');
  await processor.processIssues(1);

  expect(createCommentSpy).not.toHaveBeenCalled();
});

test('Ignore milestone', async () => {
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
  const processor = createIssueProcessorMock({
    options,
    getIssues: createGetIssues(issues)
  });
  await processor.setMaintainers();
  const createCommentSpy = jest.spyOn(processor, 'createComment');
  await processor.processIssues(1);

  expect(createCommentSpy).not.toHaveBeenCalled();
});
