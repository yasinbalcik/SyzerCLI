import os
import subprocess
import sys
import tempfile
import unittest
from decimal import Decimal

sys.path.insert(0, os.getcwd())
import ledger  # noqa: E402

D = Decimal


def write(text):
    f = tempfile.NamedTemporaryFile('w', suffix='.csv', delete=False, encoding='utf-8')
    f.write(text)
    f.close()
    return f.name


class Parse(unittest.TestCase):
    def test_basic(self):
        tx = ledger.parse_line('2026-01-05,alice,deposit,100.50')
        self.assertEqual(tx['date'], '2026-01-05')
        self.assertEqual(tx['account'], 'alice')
        self.assertEqual(tx['type'], 'deposit')
        self.assertEqual(tx['amount'], D('100.50'))
        self.assertIsNone(tx['target'])

    def test_amount_is_decimal(self):
        self.assertIsInstance(ledger.parse_line('2026-01-05,a,deposit,0.1')['amount'], Decimal)

    def test_trim(self):
        tx = ledger.parse_line(' 2026-01-05 , bob , transfer , 5 , carol \n')
        self.assertEqual((tx['account'], tx['target'], tx['amount']), ('bob', 'carol', D('5')))

    def test_invalid(self):
        bad = [
            '2026-02-30,a,deposit,1', '2026-1-5,a,deposit,1', 'x,a,deposit,1',
            '2026-01-05,,deposit,1', '2026-01-05,a,steal,1', '2026-01-05,a,deposit,0',
            '2026-01-05,a,deposit,-3', '2026-01-05,a,deposit,abc', '2026-01-05,a,deposit,1.234',
            '2026-01-05,a,transfer,1', '2026-01-05,a,transfer,1,a', '2026-01-05,a,deposit,1,b',
            '2026-01-05,a,deposit', '',
        ]
        for line in bad:
            with self.subTest(line=line):
                with self.assertRaises(ValueError):
                    ledger.parse_line(line)


class LedgerOps(unittest.TestCase):
    def setUp(self):
        self.l = ledger.Ledger()
        self.p = ledger.parse_line

    def test_unknown_zero(self):
        self.assertEqual(self.l.balance('nobody'), D('0'))

    def test_deposit_withdraw_exact(self):
        self.l.apply(self.p('2026-01-01,a,deposit,0.10'))
        self.l.apply(self.p('2026-01-01,a,deposit,0.20'))
        self.l.apply(self.p('2026-01-02,a,withdraw,0.30'))
        self.assertEqual(self.l.balance('a'), D('0'))

    def test_insufficient_no_change(self):
        self.l.apply(self.p('2026-01-01,a,deposit,10'))
        with self.assertRaises(ledger.InsufficientFunds):
            self.l.apply(self.p('2026-01-02,a,transfer,11,b'))
        self.assertEqual(self.l.balance('a'), D('10'))
        self.assertEqual(self.l.balance('b'), D('0'))
        self.assertEqual(len(self.l.history('a')), 1)
        self.assertEqual(self.l.accounts(), ['a'])

    def test_transfer_history_accounts(self):
        self.l.apply(self.p('2026-01-01,zed,deposit,50'))
        self.l.apply(self.p('2026-01-02,zed,transfer,20,amy'))
        self.assertEqual(self.l.balance('zed'), D('30'))
        self.assertEqual(self.l.balance('amy'), D('20'))
        self.assertEqual([t['type'] for t in self.l.history('amy')], ['transfer'])
        self.assertEqual(len(self.l.history('zed')), 2)
        self.assertEqual(self.l.accounts(), ['amy', 'zed'])

    def test_insufficient_is_exception_subclass(self):
        self.assertTrue(issubclass(ledger.InsufficientFunds, Exception))


SAMPLE = """# header
2026-01-01,alice,deposit,100.50

2026-01-02,bob,deposit,20
2026-01-03,bob,withdraw,50
2026-02-30,bob,deposit,1
2026-01-04,alice,transfer,0.5,bob
"""


class Load(unittest.TestCase):
    def test_load_errors_and_line_numbers(self):
        path = write(SAMPLE)
        try:
            l, errs = ledger.load(path)
        finally:
            os.unlink(path)
        self.assertEqual([n for n, _ in errs], [5, 6])
        self.assertTrue(all(isinstance(m, str) and m for _, m in errs))
        self.assertEqual(l.balance('alice'), D('100.00'))
        self.assertEqual(l.balance('bob'), D('20.50'))


class Cli(unittest.TestCase):
    def run_cli(self, *args):
        return subprocess.run([sys.executable, os.path.join(os.getcwd(), 'ledger.py'), *args], capture_output=True, text=True, timeout=30)

    def test_output_and_exit_1(self):
        path = write(SAMPLE)
        try:
            r = self.run_cli(path)
        finally:
            os.unlink(path)
        self.assertEqual(r.returncode, 1)
        self.assertEqual(r.stdout.strip().splitlines(), ['alice: 100.00', 'bob: 20.50'])
        lines = [x for x in r.stderr.strip().splitlines() if x.strip()]
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].startswith('line 5:') and lines[1].startswith('line 6:'))

    def test_clean_exit_0(self):
        path = write('2026-01-01,x,deposit,3\n')
        try:
            r = self.run_cli(path)
        finally:
            os.unlink(path)
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), 'x: 3.00')

    def test_missing_file_exit_2(self):
        r = self.run_cli(os.path.join(tempfile.gettempdir(), 'definitely-missing-ledger.csv'))
        self.assertEqual(r.returncode, 2)
        self.assertTrue(r.stderr.strip())


if __name__ == '__main__':
    unittest.main()
