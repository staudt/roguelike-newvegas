import { describe, expect, it } from 'vitest';
import { groupMessages } from '../src/ui/messageGroups';

const m = ['a', 'b', 'c', 'd', 'e'];

describe('groupMessages', () => {
  it('renders each message on its own line without groups', () => {
    expect(groupMessages(m, [])).toEqual(m);
  });
  it('joins a group with two spaces', () => {
    expect(groupMessages(m, [{ from: 1, to: 3 }])).toEqual(['a', 'b  c', 'd', 'e']);
  });
  it('handles adjacent groups', () => {
    expect(groupMessages(m, [{ from: 0, to: 2 }, { from: 2, to: 4 }])).toEqual(['a  b', 'c  d', 'e']);
  });
  it('keeps ungrouped messages between groups', () => {
    expect(groupMessages(m, [{ from: 0, to: 1 }, { from: 3, to: 5 }])).toEqual(['a', 'b', 'c', 'd  e']);
  });
  it('spans many messages', () => {
    expect(groupMessages(m, [{ from: 0, to: 5 }])).toEqual(['a  b  c  d  e']);
  });
});
