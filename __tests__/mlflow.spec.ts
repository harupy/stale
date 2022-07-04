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

test('Remind maintainers to assign maintainer if issue has no maintainer assignee', async () => {
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

test('Remind maintainer to triage if issue has assignee but no comment', async () => {
  const options = {
    ...DefaultProcessorOptions,
    mlflow: true
  };
  const issues = [
    generateIssue({
      options,
      updatedAt: getDaysAgoTimestamp(8),
      createdAt: getDaysAgoTimestamp(8),
      assignees: [MAINTAINER]
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
    expect.stringContaining(`@${MAINTAINER} Please triage this issue.`)
  );
});

test('Remind maintainer to reply when last comment was posted by non-maintainer', async () => {
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
          login: NON_MAINTAINER,
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

test('Ignore issue if last comment was posted by bot', async () => {
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

test('Ignore issue if it is triaged and has has-closing-pr label', async () => {
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

test('Ignore issue if it is triaged, has has-closing-pr label, and last comment was posted by from non-maintainer', async () => {
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

test('Ignore issues created before start-date', async () => {
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

test('Bot does not stale or close milestones', async () => {
  const options = {
    ...DefaultProcessorOptions,
    mlflow: true
  };
  const issues = [
    generateIssue({
      options,
      updatedAt: getDaysAgoTimestamp(15),
      createdAt: getDaysAgoTimestamp(15),
      milestone: 'milestone',
      assignees: [MAINTAINER]
    })
  ];
  const processor = createIssueProcessorMock({
    options,
    getIssues: createGetIssues(issues),
    listIssueComments: async () => [
      {
        user: {
          login: NON_MAINTAINER,
          type: 'User'
        },
        body: 'I found this issue on Ubuntu 18.04.',
        created_at: getDaysAgoTimestamp(7)
      },
      {
        user: {
          login: 'Bot',
          type: 'bot'
        },
        body: 'Any updates here?',
        created_at: getDaysAgoTimestamp(21)
      }
    ]
  });
  await processor.setMaintainers();
  const createCommentSpy = jest.spyOn(processor, 'createComment');
  await processor.processIssues(1);
  expect(createCommentSpy).not.toHaveBeenCalled();
  expect(processor.staleIssues).toHaveLength(0);
});
