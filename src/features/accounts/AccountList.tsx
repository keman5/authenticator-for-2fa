import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent
} from 'react';
import { createPortal } from 'react-dom';
import {
  MoreHorizontal,
  KeyRound,
  Pencil,
  QrCode,
  Star,
  Trash,
  RefreshCw
} from 'lucide-react';
import { useCopy, useVault } from '../../app/vault';
import {
  getAccountListView,
  getAccountPageMatchScore,
  getAccountPageRanking,
  type PageContext
} from '../../domain/site';
import { getErrorMessage } from '../../domain/feedback';
import type { AuthenticatorAccount } from '../../domain/view';
import { Confirm } from '../../shared/ui/controls';
import { isReorderCurrent, moveItem } from './reorder';
import { request } from '../../platform/browser';
import {
  isSiteIcon,
  readSiteIcons,
  rememberSiteIcon
} from '../../platform/siteIcons';

type Filter = 'all' | 'site' | 'fav';
export function AccountList({
  query,
  context,
  source,
  onEdit,
  onQr,
  onCopy,
  revealedAccountIds = []
}: {
  query: string;
  revealedAccountIds?: string[];
  context: PageContext | null;
  source?: number;
  onEdit: (account: AuthenticatorAccount) => void;
  onQr: (accounts: AuthenticatorAccount[]) => void;
  onCopy: (code: string, fill?: boolean) => void;
}) {
  const vault = useVault(),
    { ui, tr } = useCopy();
  const [filter, setFilter] = useState<Filter>('all'),
    [expanded, setExpanded] = useState(false),
    [menu, setMenu] = useState<string | null>(null),
    [deleting, setDeleting] = useState<AuthenticatorAccount | null>(null),
    [preview, setPreview] = useState<AuthenticatorAccount[] | null>(null),
    [dragId, setDragId] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const list = useRef<HTMLUListElement>(null);
  const drag = useRef<{
    id: string;
    ids: string[];
    pointerId: number;
    target: number;
    source: number;
  } | null>(null);
  const sortedAccounts = useMemo(() => vault.sortedAccounts, [vault, vault.accounts]);
  const ranked = useMemo(
    () => getAccountPageRanking(sortedAccounts, context),
    [sortedAccounts, context]
  );
  const [siteIcons, setSiteIcons] = useState(readSiteIcons);
  const hostname = context?.hostname;
  const shouldReadIcon =
    ranked.suggestedAccountIds.size > 0 &&
    !siteIcons.some(([host]) => host === hostname);
  useEffect(() => {
    if (!hostname || !shouldReadIcon) return;
    let active = true;
    void request<unknown>('site-icon', { hostname, source })
      .then((icon) => {
        if (active && isSiteIcon(icon)) setSiteIcons(rememberSiteIcon(hostname, icon));
      })
      .catch(() => {});
    return () => { active = false; };
  }, [hostname, context?.faviconReady, shouldReadIcon, source]);
  const accountIcons = useMemo(() => {
    const current = siteIcons.find(([host]) => host === hostname);
    return new Map(sortedAccounts.map((account) => {
      const icon = (ranked.suggestedAccountIds.has(account.id) ? current : undefined)
        ?? siteIcons.find(([host]) => getAccountPageMatchScore(account, { hostname: host }) > 0);
      return [account.id, icon?.[1]];
    }));
  }, [sortedAccounts, ranked, hostname, siteIcons]);
  const ordered =
    vault.settings.accountSortMode === 'contextual'
      ? ranked.accounts
      : sortedAccounts;
  const favoriteOrder = useMemo(
    () =>
      [...ordered].sort(
        (a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite))
      ),
    [ordered]
  );
  const visibleByDefault = new Set([
    ...revealedAccountIds,
    ...ranked.suggestedAccountIds,
    ...favoriteOrder
      .filter((account) => account.favorite)
      .map((account) => account.id)
  ]);
  const view = getAccountListView(favoriteOrder, visibleByDefault, {
    query,
    alwaysShowAll: vault.settings.alwaysShowAllCodes || filter !== 'all',
    revealAll: expanded
  });
  let accounts = preview ?? [...view.accounts, ...view.revealedAccounts];
  if (filter === 'site')
    accounts = accounts.filter((account) =>
      ranked.suggestedAccountIds.has(account.id)
    );
  if (filter === 'fav')
    accounts = accounts.filter((account) => account.favorite);
  const canReorder =
    vault.settings.accountSortMode === 'manual' &&
    !query.trim() &&
    filter === 'all' &&
    accounts.length === vault.accounts.length;
  useEffect(() => {
    setExpanded(false);
  }, [context?.hostname]);
  useEffect(() => {
    const close = (event: Event) => {
      if (!(event.target as Element).closest('.card-menu,.menu-btn'))
        setMenu(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        setMenu(null);
        setDeleting(null);
        drag.current = null;
        setPreview(null);
        setDragId(null);
      }
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, []);
  const run = (action: () => Promise<void>) => {
    void action().catch((error) => {
      vault.error = getErrorMessage(error, 'Unable to complete the action.');
    });
  };
  function start(
    event: PointerEvent<HTMLButtonElement>,
    account: AuthenticatorAccount
  ) {
    if (!canReorder || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const ids = accounts.map((a) => a.id),
      source = ids.indexOf(account.id);
    drag.current = {
      id: account.id,
      ids,
      pointerId: event.pointerId,
      target: source,
      source
    };
    setDragId(account.id);
    setPreview(accounts);
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!isReorderCurrent(favoriteOrder, current.ids)) {
      finish(true);
      return;
    }
    const cards = Array.from(
      list.current?.querySelectorAll<HTMLElement>('[data-account-id]') ?? []
    );
    const hit = cards.findIndex(
      (card) => event.clientY < card.getBoundingClientRect().bottom
    );
    current.target = hit < 0 ? cards.length - 1 : hit;
    const next = current.ids
      .map((id) => vault.accounts.find((a) => a.id === id)!)
      .filter(Boolean);
    setPreview(moveItem(next, current.source, current.target));
    const scroller = list.current?.closest('.p-body');
    if (scroller) {
      const box = scroller.getBoundingClientRect();
      if (event.clientY < box.top + 35) scroller.scrollTop -= 12;
      else if (event.clientY > box.bottom - 35) scroller.scrollTop += 12;
    }
  }
  function finish(cancel = false) {
    const current = drag.current;
    drag.current = null;
    setPreview(null);
    setDragId(null);
    if (!current || cancel || !canReorder) return;
    if (!isReorderCurrent(favoriteOrder, current.ids)) return;
    const ids = moveItem(current.ids, current.source, current.target);
    run(() => vault.reorderAccounts(ids));
  }
  async function keyboardMove(
    account: AuthenticatorAccount,
    direction: number
  ) {
    const ids = accounts.map((a) => a.id),
      index = ids.indexOf(account.id),
      target = index + direction;
    if (target < 0 || target >= ids.length) return;
    if (
      Boolean(accounts[index].favorite) !== Boolean(accounts[target].favorite)
    )
      return;
    await vault.reorderAccounts(moveItem(ids, index, target));
  }
  return (
    <>
      <div className="chips" aria-label={tr('accounts')}>
        {(['all', 'fav', 'site'] as const).map((item) => (
          <button
            type="button"
            key={item}
            className={`chip ${filter === item ? 'active' : ''}`}
            aria-pressed={filter === item}
            onClick={() => {
              setFilter(item);
              setExpanded(false);
            }}
          >
            {ui(
              item === 'all'
                ? 'chipAll'
                : item === 'site'
                  ? 'chipSite'
                  : 'chipFav'
            )}
            {item === 'all' && <span>{vault.accounts.length}</span>}
          </button>
        ))}
      </div>
      <ul
        className="list account-list"
        role="list"
        ref={list}
        hidden={!accounts.length}
      >
        {accounts.map((account, index) => {
          const code = vault.codes[account.id];
          const icon = accountIcons.get(account.id);
          const hideCode =
            vault.settings.hideCodes &&
            hovered !== account.id &&
            focused !== account.id;
          const expiring = account.type !== 'hotp' && code?.remaining <= 5;
          const groupFor = (item: AuthenticatorAccount) =>
            item.favorite
              ? 'fav'
              : ranked.suggestedAccountIds.has(item.id)
                ? 'site'
                : 'other';
          const group = groupFor(account);
          const showGroup =
            index === 0 || groupFor(accounts[index - 1]) !== group;
          return (
            <Fragment key={account.id}>
              {showGroup && (
                <li className="group-label" role="presentation">
                  {group === 'fav' ? (
                    <span className="fav-dot">
                      <Star size={11} fill="currentColor" />
                    </span>
                  ) : group === 'site' ? (
                    <span className="site-dot" />
                  ) : null}
                  {ui(
                    group === 'fav'
                      ? 'chipFav'
                      : group === 'site'
                        ? 'chipSite'
                        : 'groupAll'
                  )}
                </li>
              )}
              <li
                className={`list-row account-row ${dragId === account.id ? 'dragging' : ''}`}
                data-account-id={account.id}
                onMouseEnter={() => setHovered(account.id)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setFocused(account.id)}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget))
                    setFocused(null);
                }}
              >
                <button
                  type="button"
                  className="avatar drag-handle"
                  aria-label={`${tr('reorderAccount')}: ${account.issuer || account.label}`}
                  disabled={!canReorder}
                  onPointerDown={(event) => start(event, account)}
                  onPointerMove={move}
                  onPointerUp={() => finish()}
                  onPointerCancel={() => finish(true)}
                  onKeyDown={(event) => {
                    if (
                      canReorder &&
                      (event.key === 'ArrowUp' || event.key === 'ArrowDown')
                    ) {
                      event.preventDefault();
                      run(() =>
                        keyboardMove(account, event.key === 'ArrowUp' ? -1 : 1)
                      );
                    }
                  }}
                >
                  {icon ? (
                    <img className="size-5 pointer-events-none" src={icon} alt="" draggable={false} />
                  ) : (account.issuer || account.label).slice(0, 1).toUpperCase()}
                </button>
                <button
                  className="card-main"
                  type="button"
                  aria-label={`${tr('copy')}: ${account.issuer} ${account.label}`}
                  onClick={() => code && onCopy(code.value)}
                >
                  <div className="account-identity">
                    <span className="card-name">
                      {account.issuer || account.label}
                    </span>
                    {account.favorite && (
                      <Star
                        size={11}
                        className="fav-dot shrink-0"
                        fill="currentColor"
                        aria-hidden="true"
                      />
                    )}
                    {account.issuer && account.issuer !== account.label && (
                      <span className="card-acct">{account.label}</span>
                    )}
                  </div>
                  <div className="card-code">
                    <span
                      className={`code ${hideCode ? 'hidden-code' : ''} ${expiring ? 'low' : ''}`}
                      key={expiring ? code.remaining : 'code'}
                    >
                      {hideCode
                        ? '••• •••'
                        : (code?.value.replace(/(.{3})(?=.)/g, '$1 ') ??
                          '— — —')}
                    </span>
                  </div>
                </button>
                <div className="account-actions">
                  <div className="account-tools">
                    {account.type === 'hotp' && (
                      <button
                        className="menu-btn"
                        type="button"
                        aria-label={tr('next')}
                        onClick={() => run(() => vault.advanceHotp(account))}
                      >
                        <RefreshCw size={14} />
                      </button>
                    )}
                    <button
                      className="fill-btn"
                      type="button"
                      onClick={() => code && onCopy(code.value, true)}
                    >
                      {ui('fill')}
                    </button>
                    <button
                      className="menu-btn"
                      type="button"
                      aria-label={`${tr('settings')}: ${account.issuer} ${account.label}`}
                      aria-expanded={menu === account.id}
                      onClick={(event) => {
                        const box = event.currentTarget.getBoundingClientRect();
                        setMenuPosition({
                          top: Math.max(
                            6,
                            Math.min(box.bottom + 5, window.innerHeight - 160)
                          ),
                          left: Math.max(6, box.right - 170)
                        });
                        setMenu(menu === account.id ? null : account.id);
                      }}
                    >
                      <MoreHorizontal size={16} />
                    </button>
                  </div>
                  {vault.settings.showCountdownSeconds &&
                    account.type !== 'hotp' && (
                      <span
                        className={`secs text-center ${code?.remaining <= 5 ? 'low' : ''}`}
                      >
                        {code?.remaining ?? ''}s
                      </span>
                    )}
                </div>
                {menu === account.id &&
                  createPortal(
                    <div
                      className="card-menu"
                      style={{
                        position: 'fixed',
                        right: 'auto',
                        ...menuPosition
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setMenu(null);
                          run(() =>
                            vault.updateAccount(account, {
                              favorite: !account.favorite
                            })
                          );
                        }}
                      >
                        <Star size={13} />
                        {ui(account.favorite ? 'unfav' : 'fav')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMenu(null);
                          onEdit(account);
                        }}
                      >
                        <Pencil size={13} />
                        {ui('edit')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMenu(null);
                          onQr([account]);
                        }}
                      >
                        <QrCode size={13} />
                        {ui('showQr')}
                      </button>
                      <button
                        className="danger"
                        type="button"
                        onClick={() => {
                          setMenu(null);
                          setDeleting(account);
                        }}
                      >
                        <Trash size={13} />
                        {ui('del')}
                      </button>
                    </div>,
                    document.querySelector('.pui') ?? document.body
                  )}
              </li>
            </Fragment>
          );
        })}
      </ul>
      {filter === 'all' && view.contextualAction && (
        <div className="fold-bar">
          <button
            className="fold-btn"
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {ui(expanded ? 'collapse' : 'expandAll', { n: view.hiddenCount })}
          </button>
        </div>
      )}
      {accounts.length === 0 && (
        <div className="empty visible">
          <div className="empty-symbol">
            <KeyRound size={28} strokeWidth={1.4} aria-hidden="true" />
          </div>
          <strong>{vault.accounts.length ? ui('empty1') : tr('empty')}</strong>
          <p>{vault.accounts.length ? ui('empty2') : tr('emptyHint')}</p>
        </div>
      )}
      {deleting && (
        <Confirm
          title={ui('deleteAccount')}
          onCancel={() => setDeleting(null)}
          onConfirm={() =>
            run(async () => {
              await vault.deleteAccount(deleting);
              setDeleting(null);
            })
          }
        >
          <p className="desc">
            {deleting.issuer} · {deleting.label}
          </p>
        </Confirm>
      )}
    </>
  );
}
