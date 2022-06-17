import {Issue} from '../src/classes/issue';
import {IssuesProcessorMock} from './classes/issues-processor-mock';
import {DefaultProcessorOptions} from './constants/default-processor-options';
import {generateIssue} from './functions/generate-issue';

test('Should post a comment asking maintainers to assign a maintainer when an issue has no assignees and comments', async () => {
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
      '2020-01-01T17:00:00Z',
      '2020-01-01T17:00:00Z',
      false,
      ['Stale'],
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

  // process our fake issue list
  await processor.processIssues(1);

  expect(createCommentSpy).toHaveBeenCalledWith(
    expect.anything(),
    'Hi, MLflow maintainers. Please assign a maintainer to this issue and triage it.'
  );
});
