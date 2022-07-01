import {DefaultProcessorOptions} from './constants/default-processor-options';
import {
  TODAY,
  MAINTAINER,
  NON_MAINTAINER,
  generateIssue,
  createGetIssues,
  getDaysAgoTimestamp,
  createIssueProcessorMock
} from './mlflow-test-utils';

test('Remind maintainers to assign a maintainer when an issue has no maintainer assignees', async () => {
  const options = {
    ...DefaultProcessorOptions,
    mlflow: true
  };
  const issues = [
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
  const issues = [
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
  const issues = [
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
  const issues = [
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
  const issues = [
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

test('Ignore issue if it is triaged, has has-closing-pr label, and last comment is from non-maintainer', async () => {
  const options = {
    ...DefaultProcessorOptions,
    mlflow: true
  };
  const issues = [
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
      },
      {
        user: {
          login: NON_MAINTAINER,
          type: 'User'
        },
        body: 'Thanks!',
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
  const issues = [
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
    startDate: TODAY
  };
  const issues = [
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
  const issues = [
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
