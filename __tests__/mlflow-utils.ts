import {Issue} from '../src/classes/issue';
import {IUser} from '../src/interfaces/user';
import {IIssuesProcessorOptions} from '../src/interfaces/issues-processor-options';
import {IsoDateString} from '../src/types/iso-date-string';
import {IssuesProcessorMock} from './classes/issues-processor-mock';
import {IPullRequest} from '../src/interfaces/pull-request';
import {IComment} from '../src/interfaces/comment';
import {generateIssue as _generateIssue} from './functions/generate-issue';

export const getDaysAgoTimestamp = (
  numOfDays: number,
  date: Date = new Date()
): IsoDateString => {
  const daysAgo = new Date(date.getTime());
  daysAgo.setDate(date.getDate() - numOfDays);
  const withoutMilliseconds = daysAgo.toISOString().split('.')[0];
  return `${withoutMilliseconds}Z`;
};
export const TODAY = getDaysAgoTimestamp(0);

export function createGetIssues(
  issues: Issue[]
): (page: number) => Promise<Issue[]> {
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

export const generateIssue = ({
  options,
  id = 1,
  title = 'Issue',
  updatedAt = TODAY,
  createdAt = TODAY,
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

export const MAINTAINER = 'maintainer';
export const NON_MAINTAINER = 'non-maintainer';

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

export const createIssueProcessorMock = ({
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
