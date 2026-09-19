/**
 * Naturalness assessment for Polish target text.
 *
 * The QA module catches things that BREAK: a lost placeholder, an unbalanced
 * bracket, a missing translation. This module catches things that are
 * *correct but wrong* -- text that is a faithful, grammatical, and completely
 * unnatural translation of the English.
 *
 * That distinction matters because the failure mode of a machine-translated
 * Polish game string is almost never a syntax error. It is:
 *
 *   "Zostalo Ci 5 HP"          missing diacritics, reads as broken
 *   "Adresujemy ten problem"   "to address" -- you do not address problems in Polish
 *   "Dokonaj zakupu"           periphrasis for "kup"
 *   "22 plików"                wrong numeral agreement; 22 takes "pliki"
 *   "Został otwarty przez gracza"   passive, where Polish wants the active voice
 *
 * Every finding carries a concrete fix where a mechanical one exists, because
 * "this reads badly" is not actionable and a translator will (rightly) ignore
 * it.
 *
 * PRECISION OVER RECALL. A panel that flags everything gets dismissed wholesale,
 * which is worse than no panel. Two rules follow from that:
 *
 *   1. Only findings with a mechanical, grammar-preserving fix get one. A calque
 *      whose replacement needs the sentence rebuilt reports a suggestion and
 *      deliberately has no `fix`, because auto-applying it would produce broken
 *      Polish -- which is worse than leaving the text alone.
 *   2. Findings that could plausibly be intentional are INFO, and every check is
 *      individually mutable from the UI.
 */

import { SEVERITY } from './constants.js';

/**
 * Severity comes from the shared vocabulary, not a local copy.
 *
 * This module originally declared its own `FINDING = { ERROR, warning, INFO }`.
 * That mixed casing meant every `FINDING.WARNING` reference evaluated to
 * `undefined`, so five checks silently fell back to the info penalty and
 * emitted findings carrying no severity at all -- which any consumer doing a
 * colour or ordering lookup would choke on. Importing the one canonical
 * constant is what makes that class of typo impossible rather than merely
 * fixed.
 */

/** Weight subtracted from 100 per finding, by severity. */
const PENALTY = { [SEVERITY.ERROR]: 12, [SEVERITY.WARNING]: 5, [SEVERITY.INFO]: 2 };

// ---------------------------------------------------------------------------
// Folding
// ---------------------------------------------------------------------------

const FOLD_MAP = {
  ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z',
  Ą: 'A', Ć: 'C', Ę: 'E', Ł: 'L', Ń: 'N', Ó: 'O', Ś: 'S', Ź: 'Z', Ż: 'Z',
};

/**
 * Strip Polish diacritics, preserving length one-for-one.
 *
 * Length preservation is the point: it means an index found in the folded text
 * is the same index in the original, so a phrase can be matched accent-blind and
 * still reported with its real spelling. Calque detection needs this, because a
 * text with missing diacritics is exactly the text most likely to also contain
 * calques.
 */
export function fold(text) {
  return String(text ?? '').replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (char) => FOLD_MAP[char] ?? char);
}

// ---------------------------------------------------------------------------
// Diacritics
// ---------------------------------------------------------------------------

/**
 * Polish words whose ASCII spelling is a common typing shortcut.
 *
 * This is the single highest-value check for Polish and it cannot be done
 * generically: a heuristic that guesses which words "should" have diacritics
 * produces nonsense on loanwords and proper nouns. A curated list of words that
 * are unambiguously wrong without them is both precise and, because these are
 * the highest-frequency words in the language, broad in practice.
 *
 * Entries whose "fix" is identical to the key are omitted -- see IDENTITY note
 * in restoreDiacritics.
 */
const DIACRITICS = {
  // ---- verbs
  bedzie: 'będzie', bede: 'będę', beda: 'będą', bedziesz: 'będziesz',
  jestes: 'jesteś', jestesmy: 'jesteśmy', jestescie: 'jesteście',
  byc: 'być', zrobic: 'zrobić', zrobil: 'zrobił', zrobila: 'zrobiła',
  zrobili: 'zrobili', robic: 'robić', robil: 'robił', robila: 'robiła',
  isc: 'iść', idz: 'idź', jesc: 'jeść', widziec: 'widzieć', wiedziec: 'wiedzieć',
  chciec: 'chcieć', chcial: 'chciał', chciala: 'chciała', chcieli: 'chcieli',
  moc: 'móc', moga: 'mogą', moze: 'może', mozesz: 'możesz', moglem: 'mogłem',
  pomoc: 'pomóc', pomoze: 'pomoże', mowic: 'mówić', mowi: 'mówi',
  powiedziec: 'powiedzieć', znalezc: 'znaleźć', znalazl: 'znalazł',
  wziasc: 'wziąć', wziac: 'wziąć', dac: 'dać', znac: 'znać',
  musial: 'musiał', musiala: 'musiała',
  mial: 'miał', miala: 'miała', mieli: 'mieli',
  zostal: 'został', zostala: 'została', zostalo: 'zostało', zostaly: 'zostały',
  wyslac: 'wysłać', wyslal: 'wysłał', otworzyc: 'otworzyć', zamknac: 'zamknąć',
  uruchomic: 'uruchomić', uzyc: 'użyć', uzywac: 'używać', kupic: 'kupić',
  wybrac: 'wybrać', dodac: 'dodać', usunac: 'usunąć',
  zmienic: 'zmienić', sprawdzic: 'sprawdzić', ustawic: 'ustawić',
  zapisac: 'zapisać', wczytac: 'wczytać', kontynuowac: 'kontynuować',
  zaczac: 'zacząć', skonczyc: 'skończyć', przejsc: 'przejść', wejsc: 'wejść',
  wyjsc: 'wyjść', przyjsc: 'przyjść', pojsc: 'pójść', dostac: 'dostać',
  czekac: 'czekać', szukac: 'szukać', grac: 'grać', wygrac: 'wygrać',
  przegrac: 'przegrać', zaczynac: 'zaczynać', konczyc: 'kończyć',
  nacisnac: 'nacisnąć', nacisnij: 'naciśnij', kliknac: 'kliknąć',
  przytrzymac: 'przytrzymać', wcisnac: 'wcisnąć', przewinac: 'przewinąć',
  wybrac: 'wybrać', odtworzyc: 'odtworzyć', nagrac: 'nagrać',
  zapisywac: 'zapisywać', wczytywac: 'wczytywać', wyswietlac: 'wyświetlać',
  wyswietlic: 'wyświetlić', ukryc: 'ukryć', odkryc: 'odkryć',
  odblokowac: 'odblokować', zablokowac: 'zablokować',
  zaatakowac: 'zaatakować', obronic: 'obronić', uciekac: 'uciekać',
  wskazac: 'wskazać', wybrac: 'wybrać', wybrac: 'wybrać',
  porzucic: 'porzucić', podniesc: 'podnieść', opuscic: 'opuścić',
  naladowac: 'naładować', rozladowac: 'rozładować', wyleczyc: 'wyleczyć',
  uleczyc: 'uleczyć', zabic: 'zabić', zginac: 'zginąć', zginal: 'zginął',
  ozywic: 'ożywić', przywolac: 'przywołać', wywolac: 'wywołać',
  polaczyc: 'połączyć', rozlaczyc: 'rozłączyć', dolaczyc: 'dołączyć',
  udostepnic: 'udostępnić', pobrac: 'pobrać', wyslac: 'wysłać',
  skopiowac: 'skopiować', wkleic: 'wkleić', wyciac: 'wyciąć',
  cofnac: 'cofnąć', powtorzyc: 'powtórzyć', przywrocic: 'przywrócić',
  odswiez: 'odśwież', odswiezyc: 'odświeżyć', potwierdz: 'potwierdź',
  potwierdzic: 'potwierdzić', zaakceptowac: 'zaakceptować', odrzucic: 'odrzucić',
  zaprosic: 'zaprosić', dolaczyc: 'dołączyć', opuscic: 'opuścić',

  // ---- nouns
  zycie: 'życie', zycia: 'życia', zyc: 'żyć', zyje: 'żyje',
  zdrowie: 'zdrowie', zdrowia: 'zdrowia',
  pieniadze: 'pieniądze', pieniedzy: 'pieniędzy',
  wiadomosc: 'wiadomość', wiadomosci: 'wiadomości',
  odpowiedz: 'odpowiedź',
  mozliwosc: 'możliwość', mozliwosci: 'możliwości',
  jakosc: 'jakość', jakosci: 'jakości', ilosc: 'ilość', ilosci: 'ilości',
  predkosc: 'prędkość', predkosci: 'prędkości',
  trudnosc: 'trudność', trudnosci: 'trudności',
  wlasnosc: 'własność', wartosc: 'wartość', wartosci: 'wartości',
  czesc: 'część', czesci: 'części',
  poziomow: 'poziomów', plikow: 'plików', punktow: 'punktów',
  miesiac: 'miesiąc', miesiace: 'miesiące', miesiecy: 'miesięcy',
  tydzien: 'tydzień',
  przyciskow: 'przycisków', graczy: 'graczy', wrogow: 'wrogów',
  postac: 'postać', postaci: 'postaci', postacie: 'postacie',
  bron: 'broń', zadania: 'zadania', zadan: 'zadań',
  nagroda: 'nagroda', nagrody: 'nagrody', nagrod: 'nagród',
  odznaka: 'odznaka', odznaki: 'odznaki', odznak: 'odznak',
  osiagniecie: 'osiągnięcie', osiagniecia: 'osiągnięcia', osiagniec: 'osiągnięć',
  umiejetnosc: 'umiejętność', umiejetnosci: 'umiejętności',
  zaklecie: 'zaklęcie', zaklecia: 'zaklęcia', zaklec: 'zaklęć',
  mikstura: 'mikstura', mikstury: 'mikstury', mikstur: 'mikstur',
  sklepow: 'sklepów',
  wyswietlacz: 'wyświetlacz', wyswietl: 'wyświetl',
  wyjscie: 'wyjście', wejscie: 'wejście',
  powrot: 'powrót', powrotu: 'powrotu',
  blad: 'błąd', bledy: 'błędy', bledow: 'błędów',
  ostrzezenie: 'ostrzeżenie', ostrzezenia: 'ostrzeżenia',
  oszczedz: 'oszczędź', oszczedzanie: 'oszczędzanie', oszczednosci: 'oszczędności',
  odleglosc: 'odległość', odleglosci: 'odległości',
  wielkosc: 'wielkość', wielkosci: 'wielkości', dlugosc: 'długość',
  szerokosc: 'szerokość', wysokosc: 'wysokość', glebokosc: 'głębokość',
  cisnienie: 'ciśnienie',
  srodowisko: 'środowisko', srodowiska: 'środowiska',
  narzedzie: 'narzędzie', narzedzia: 'narzędzia', narzedzi: 'narzędzi',
  urzadzenie: 'urządzenie', urzadzenia: 'urządzenia',
  wydajnosc: 'wydajność', wydajnosci: 'wydajności',
  bezpieczenstwo: 'bezpieczeństwo', bezpieczenstwa: 'bezpieczeństwa',
  doswiadczenie: 'doświadczenie', doswiadczenia: 'doświadczenia',
  swiat: 'świat', swiata: 'świata', swiecie: 'świecie',
  czlowiek: 'człowiek', ludzi: 'ludzi',
  kobieta: 'kobieta', mezczyzna: 'mężczyzna', dziecko: 'dziecko', dzieci: 'dzieci',
  rodzina: 'rodzina', rodziny: 'rodziny', przyjaciel: 'przyjaciel', przyjaciele: 'przyjaciele',
  miejsce: 'miejsce', miejsca: 'miejsca', miejsc: 'miejsc',
  strona: 'strona', strony: 'strony', stron: 'stron',
  slowo: 'słowo', slowa: 'słowa', slow: 'słów',
  zdanie: 'zdanie', zdania: 'zdania', zdan: 'zdań',
  pytanie: 'pytanie', pytania: 'pytania', pytan: 'pytań',
  znaczenie: 'znaczenie', znaczenia: 'znaczenia',
  nazwa: 'nazwa', nazwy: 'nazwy', nazw: 'nazw',
  imie: 'imię', imienia: 'imienia', nazwisko: 'nazwisko',
  jezyk: 'język', jezyka: 'języka', jezyki: 'języki',
  klawisz: 'klawisz', klawisze: 'klawisze', klawiszy: 'klawiszy',
  klawiatura: 'klawiatura', klawiatury: 'klawiatury',
  ekran: 'ekran', ekranu: 'ekranu', okno: 'okno', okna: 'okna',
  rozdzielczosc: 'rozdzielczość', dzwiek: 'dźwięk', dzwieku: 'dźwięku',
  muzyka: 'muzyka', muzyki: 'muzyki', obraz: 'obraz', obrazu: 'obrazu',
  krew: 'krew', krwi: 'krwi', ogien: 'ogień', ognia: 'ognia',
  woda: 'woda', wody: 'wody', ziemia: 'ziemia', ziemi: 'ziemi',
  cien: 'cień', cienia: 'cienia',
  swiatlo: 'światło', swiatla: 'światła', ciemnosc: 'ciemność',
  dzien: 'dzień', dnia: 'dnia',
  wieczor: 'wieczór', wieczoru: 'wieczoru',
  czas: 'czas', czasu: 'czasu', chwila: 'chwila', chwile: 'chwilę',
  koniec: 'koniec', konca: 'końca', poczatek: 'początek', poczatku: 'początku',
  srodek: 'środek', srodka: 'środka', gora: 'góra', gory: 'góry',
  dolu: 'dolu', przod: 'przód', tyl: 'tył',
  srodowisko: 'środowisko', sciezka: 'ścieżka', sciezki: 'ścieżki', sciezek: 'ścieżek',
  wyswietlanie: 'wyświetlanie', ustawienie: 'ustawienie', ustawien: 'ustawień',
  polaczenie: 'połączenie', polaczenia: 'połączenia', polaczen: 'połączeń',
  zabezpieczenie: 'zabezpieczenie', uprawnienie: 'uprawnienie', uprawnien: 'uprawnień',
  wlasciwosc: 'właściwość', wlasciwosci: 'właściwości',
  zaleznosc: 'zależność', zaleznosci: 'zależności',
  kolejnosc: 'kolejność', kolejnosci: 'kolejności',
  dostepnosc: 'dostępność', dostepnosci: 'dostępności',
  liczba: 'liczba', liczby: 'liczby', liczb: 'liczb',
  suma: 'suma', sumy: 'sumy', sum: 'sum',
  wynik: 'wynik', wyniki: 'wyniki', wynikow: 'wyników',
  gra: 'gra', gry: 'gry', gier: 'gier',
  gracz: 'gracz', gracze: 'gracze',
  poziom: 'poziom', poziomy: 'poziomy',
  mapa: 'mapa', mapy: 'mapy', map: 'map',
  swiat: 'świat', misja: 'misja', misje: 'misje', misji: 'misji',
  cel: 'cel', celu: 'celu', cele: 'cele', celow: 'celów',
  wrog: 'wróg', wrogowie: 'wrogowie',
  druzyna: 'drużyna', druzyny: 'drużyny',
  bohater: 'bohater', bohatera: 'bohatera', bohaterowie: 'bohaterowie',
  historia: 'historia', historii: 'historii',
  przygoda: 'przygoda', przygody: 'przygody',
  swiat: 'świat', krolestwo: 'królestwo', krolestwa: 'królestwa',
  zamkniete: 'zamknięte', otwarte: 'otwarte',
  wiadomosci: 'wiadomości', powiadomienie: 'powiadomienie',
  ustawienia: 'ustawienia', opcje: 'opcje', opcji: 'opcji',
  profil: 'profil', profilu: 'profilu', konto: 'konto', konta: 'konta',
  haslo: 'hasło', hasla: 'hasła', login: 'login',
  uzytkownik: 'użytkownik', uzytkownika: 'użytkownika', uzytkownicy: 'użytkownicy',
  wyswietl: 'wyświetl', wyswietlone: 'wyświetlone',
  zakonczone: 'zakończone', rozpoczete: 'rozpoczęte',
  zapisane: 'zapisane', zapisanych: 'zapisanych',
  usuniete: 'usunięte', usunietych: 'usuniętych',
  dostepne: 'dostępne', dostepnych: 'dostępnych',
  niedostepne: 'niedostępne', wymagane: 'wymagane', wymaganych: 'wymaganych',
  wybrane: 'wybrane', wybranych: 'wybranych',
  ukryte: 'ukryte', widoczne: 'widoczne', widocznych: 'widocznych',
  wlaczone: 'włączone', wylaczone: 'wyłączone',
  gotowe: 'gotowe', gotowych: 'gotowych',
  puste: 'puste', pustych: 'pustych', pelne: 'pełne', pelnych: 'pełnych',
  nowe: 'nowe', nowych: 'nowych', stare: 'stare', starych: 'starych',
  wszystkie: 'wszystkie', wszystkich: 'wszystkich',
  zadne: 'żadne', zadnych: 'żadnych', zadnego: 'żadnego',
  kazde: 'każde', kazdego: 'każdego', kazdym: 'każdym',
  pozostale: 'pozostałe', pozostalych: 'pozostałych',
  nastepne: 'następne', nastepny: 'następny', nastepna: 'następna',
  poprzednie: 'poprzednie', poprzedni: 'poprzedni',
  ostatnie: 'ostatnie', ostatni: 'ostatni', ostatnia: 'ostatnia',
  pierwsze: 'pierwsze', pierwszy: 'pierwszy', pierwsza: 'pierwsza',
  kolejne: 'kolejne', kolejny: 'kolejny',
  wiecej: 'więcej', najwiecej: 'najwięcej',
  mniej: 'mniej', najmniej: 'najmniej',
  wieksze: 'większe', wiekszy: 'większy', wieksza: 'większa',
  mniejsze: 'mniejsze', mniejszy: 'mniejszy', mniejsza: 'mniejsza',
  najwieksze: 'największe', najmniejsze: 'najmniejsze',
  dluzsze: 'dłuższe', krotsze: 'krótsze',
  szybciej: 'szybciej', wolniej: 'wolniej', wyzej: 'wyżej', nizej: 'niżej',
  blizej: 'bliżej', dalej: 'dalej', glebiej: 'głębiej',
  latwiej: 'łatwiej', trudniej: 'trudniej', lepiej: 'lepiej', gorzej: 'gorzej',

  // ---- adjectives / adverbs
  wlasnie: 'właśnie', wlasciwie: 'właściwie', wlasciwy: 'właściwy',
  wlasciwa: 'właściwa', wlasciwe: 'właściwe',
  tez: 'też', juz: 'już', az: 'aż', wciaz: 'wciąż',
  ciagle: 'ciągle', rowniez: 'również', takze: 'także', przeciez: 'przecież',
  zeby: 'żeby', jesli: 'jeśli', jezeli: 'jeżeli', poniewaz: 'ponieważ',
  naprawde: 'naprawdę', oczywiscie: 'oczywiście', mozliwe: 'możliwe',
  niemozliwe: 'niemożliwe', wazne: 'ważne', wazny: 'ważny', wazna: 'ważna',
  waznych: 'ważnych', duzo: 'dużo', malo: 'mało',
  dlugi: 'długi', dluga: 'długa', dlugie: 'długie',
  krotki: 'krótki', krotka: 'krótka', krotkie: 'krótkie',
  zly: 'zły', zla: 'zła', zle: 'złe',
  maly: 'mały', mala: 'mała', male: 'małe',
  latwy: 'łatwy', latwa: 'łatwa', latwe: 'łatwe',
  ciezki: 'ciężki', ciezka: 'ciężka', ciezkie: 'ciężkie',
  slaby: 'słaby', slaba: 'słaba', slabe: 'słabe',
  cieply: 'ciepły', goracy: 'gorący', swiezy: 'świeży',
  zajety: 'zajęty', zajeta: 'zajęta', zmeczony: 'zmęczony', zmeczona: 'zmęczona',
  glodny: 'głodny', szczesliwy: 'szczęśliwy', szczesliwa: 'szczęśliwa',
  madry: 'mądry', glupi: 'głupi',
  ciezko: 'ciężko', latwo: 'łatwo', czesto: 'często',
  niedlugo: 'niedługo', wkrotce: 'wkrótce',
  powinienes: 'powinieneś', powinien: 'powinien',
  mozna: 'można', nalezy: 'należy',
  niemozliwy: 'niemożliwy', konieczny: 'konieczny', potrzebny: 'potrzebny',
  wylaczony: 'wyłączony', wlaczony: 'włączony', wlacz: 'włącz', wylacz: 'wyłącz',
  usuniety: 'usunięty', zapisany: 'zapisany', wyswietlany: 'wyświetlany',
  wcisniety: 'wciśnięty', zaznaczony: 'zaznaczony', odznaczony: 'odznaczony',
  wroc: 'wróć', wyjdz: 'wyjdź', przejdz: 'przejdź', sprawdz: 'sprawdź',
  zmien: 'zmień', usun: 'usuń', uzyj: 'użyj', skoncz: 'skończ',
  powtorz: 'powtórz', wznow: 'wznów',
  sroda: 'środa', piatek: 'piątek', poniedzialek: 'poniedziałek',
  wrzesien: 'wrzesień', pazdziernik: 'październik', grudzien: 'grudzień',
  styczen: 'styczeń', kwiecien: 'kwiecień', sierpien: 'sierpień',
  polski: 'polski', polska: 'polska', polskie: 'polskie',
  angielski: 'angielski', angielska: 'angielska', angielskie: 'angielskie',
  niemiecki: 'niemiecki', hiszpanski: 'hiszpański',
  wloski: 'włoski', rosyjski: 'rosyjski', chinski: 'chiński',
  japonski: 'japoński', koreanski: 'koreański', francuski: 'francuski',
  srodkowy: 'środkowy', srodkowa: 'środkowa', srodkowe: 'środkowe',
  gorny: 'górny', gorna: 'górna', gorne: 'górne',
  dolny: 'dolny', dolna: 'dolna', dolne: 'dolne',
  lewy: 'lewy', prawy: 'prawy', przedni: 'przedni', tylny: 'tylny',
  jasny: 'jasny', ciemny: 'ciemny', czerwony: 'czerwony', zielony: 'zielony',
  niebieski: 'niebieski', zolty: 'żółty', czarny: 'czarny', bialy: 'biały',
  zloty: 'złoty', srebrny: 'srebrny', brazowy: 'brązowy', szary: 'szary',
  fioletowy: 'fioletowy', pomaranczowy: 'pomarańczowy', rozowy: 'różowy',
};

/**
 * Words that must never be "restored": valid Polish as written, loanwords, or
 * forms that a numeral check should own instead. Checked before the dictionary
 * so a real word is never rewritten.
 */
const DIACRITIC_SAFE = new Set([
  'maj', 'luty', 'noc', 'czas', 'krew', 'bron', 'dol', 'bok', 'menu', 'login',
  'wersja', 'wersje', 'punkt', 'punkty', 'klucz', 'klucze', 'poziom', 'pliki',
  'minuty', 'sekundy', 'godziny', 'dni', 'lata', 'lat', 'rzeczy', 'czasu',
  'ceny', 'cena', 'nazwy', 'nazwa', 'strony', 'strona', 'miejsca', 'miejsce',
  'wody', 'ziemi', 'gory', 'dolu', 'boku', 'dnia', 'roku', 'gracz', 'gracze',
  'misja', 'misje', 'misji', 'profil', 'konto', 'konta', 'opcje', 'opcji',
  'ekran', 'okno', 'okna', 'obraz', 'muzyka', 'woda', 'rodzina', 'historia',
  'suma', 'sumy', 'gra', 'gry', 'mapa', 'mapy', 'cel', 'celu', 'cele',
  'kobieta', 'dziecko', 'rodzina', 'nazwisko', 'ekwipunek', 'bohater',
]);

/**
 * Copy the capitalisation of `sample` onto `value`.
 *
 * Substitutions are stored lower case, so without this "Podejmij decyzję"
 * becomes "zdecyduj decyzję" -- the fix is right but the sentence now starts
 * with a lower-case letter, which looks like a new mistake.
 */
function applyCase(value, sample) {
  if (sample.length > 1 && sample === sample.toUpperCase() && /\p{L}/u.test(sample)) {
    return value.toUpperCase();
  }
  if (/^\p{Lu}/u.test(sample)) return value.charAt(0).toUpperCase() + value.slice(1);
  return value;
}

/**
 * Case-preserving lookup. Returns null when there is nothing to fix, including
 * when the "fix" would be identical to the input -- a dictionary entry whose
 * value equals its key is a valid Polish word and must never be reported as a
 * misspelling.
 */
function restoreDiacritics(word) {
  const lower = word.toLowerCase();
  const restored = DIACRITICS[lower];
  if (!restored || restored === lower) return null;
  return applyCase(restored, word);
}

/** True when a word is a known misspelling worth reporting. */
function isMisspelt(word) {
  const lower = word.toLowerCase();
  if (DIACRITIC_SAFE.has(lower)) return false;
  const restored = DIACRITICS[lower];
  return Boolean(restored) && restored !== lower;
}

// ---------------------------------------------------------------------------
// Numeral agreement
// ---------------------------------------------------------------------------

/**
 * Polish numeral agreement for countable nouns.
 *
 * The rule: 1 takes the singular, numbers ending 2-4 (except 12-14) take the
 * nominative plural, everything else takes the genitive plural. So it is
 * "2 pliki" but "5 plików", and "22 pliki" but "12 plików". Getting this wrong
 * is the most recognisable sign of machine translation to a Polish reader, and
 * it is fully mechanical -- which is exactly what makes it worth automating.
 */
const COUNTABLE = [
  ['plik', 'pliki', 'plików'],
  ['punkt', 'punkty', 'punktów'],
  ['poziom', 'poziomy', 'poziomów'],
  ['sekunda', 'sekundy', 'sekund'],
  ['minuta', 'minuty', 'minut'],
  ['godzina', 'godziny', 'godzin'],
  ['dzień', 'dni', 'dni'],
  ['tydzień', 'tygodnie', 'tygodni'],
  ['miesiąc', 'miesiące', 'miesięcy'],
  ['moneta', 'monety', 'monet'],
  ['gwiazdka', 'gwiazdki', 'gwiazdek'],
  ['odznaka', 'odznaki', 'odznak'],
  ['zadanie', 'zadania', 'zadań'],
  ['osiągnięcie', 'osiągnięcia', 'osiągnięć'],
  ['przedmiot', 'przedmioty', 'przedmiotów'],
  ['wróg', 'wrogowie', 'wrogów'],
  ['gracz', 'gracze', 'graczy'],
  ['postać', 'postacie', 'postaci'],
  ['klucz', 'klucze', 'kluczy'],
  ['mikstura', 'mikstury', 'mikstur'],
  ['zaklęcie', 'zaklęcia', 'zaklęć'],
  ['nagroda', 'nagrody', 'nagród'],
  ['błąd', 'błędy', 'błędów'],
  ['komunikat', 'komunikaty', 'komunikatów'],
  ['przycisk', 'przyciski', 'przycisków'],
  ['milion', 'miliony', 'milionów'],
  ['tysiąc', 'tysiące', 'tysięcy'],
  ['godzina', 'godziny', 'godzin'],
  ['wróg', 'wrogowie', 'wrogów'],
];

/** Which of the three forms a count takes. */
export function expectedForm(count) {
  const abs = Math.abs(count);
  if (abs === 1) return 0;
  const lastTwo = abs % 100;
  const last = abs % 10;
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return 1;
  return 2;
}

/**
 * Build the matcher for one noun.
 *
 * Alternatives are ordered longest-first because JS regex alternation is
 * ordered: `plik|pliki|plików` matches "plik" inside "plików" and then reports
 * the correct "5 plików" as an error, offering to "fix" it into "5 plikówów".
 * The folded spelling is included too, so a noun typed without diacritics is
 * still handled by the numeral rule rather than being "corrected" into the
 * wrong form by the diacritics check.
 */
function numeralPattern(forms) {
  const alternatives = new Set();
  for (const form of forms) {
    alternatives.add(form);
    alternatives.add(fold(form));
  }
  const ordered = [...alternatives].sort((a, b) => b.length - a.length);
  return new RegExp(`\\b(\\d{1,7})\\s+(${ordered.join('|')})\\b`, 'g');
}

const NUMERAL_PATTERNS = COUNTABLE.map((forms) => ({ forms, pattern: numeralPattern(forms) }));

/**
 * Numeral findings, plus the character ranges they cover.
 *
 * The ranges are returned so the diacritics check can leave those words alone:
 * "3 punktow" should become "3 punkty" (the numeral rule), not "3 punktów"
 * (a naive diacritic restoration, which is a real but different mistake).
 */
function numeralFindings(text) {
  const findings = [];
  const covered = [];

  for (const { forms, pattern } of NUMERAL_PATTERNS) {
    pattern.lastIndex = 0;

    for (const match of text.matchAll(pattern)) {
      const [whole, digits, noun] = match;
      const count = Number(digits);
      const wanted = expectedForm(count);
      const foldedNoun = fold(noun).toLowerCase();
      const actual = forms.findIndex((form) => fold(form).toLowerCase() === foldedNoun);

      if (actual === -1 || actual === wanted) continue;

      // Only claim the span when this check is actually going to rewrite it.
      //
      // Suppressing diacritics unconditionally was a bug: "Masz 5 punktow" has
      // the *correct* form (genitive plural) and only lacks the accent, so the
      // numeral rule stays silent -- and because the span was marked as covered
      // anyway, the diacritics check stayed silent too and the missing "ó" was
      // never restored. Claiming the span only when a fix is emitted lets the
      // diacritics pass handle the case the numeral rule does not own.
      covered.push([match.index, match.index + whole.length]);

      findings.push({
        code: 'numeral-agreement',
        severity: SEVERITY.ERROR,
        message: `„${whole}" → „${digits} ${forms[wanted]}"`,
        detail:
          wanted === 0
            ? 'Liczba 1 łączy się z liczbą pojedynczą.'
            : wanted === 1
              ? 'Liczby kończące się na 2–4 (poza 12–14) łączą się z mianownikiem liczby mnogiej.'
              : 'Pozostałe liczby łączą się z dopełniaczem liczby mnogiej.',
        fix: { kind: 'replace', from: whole, to: `${digits} ${forms[wanted]}` },
        match: whole,
      });
    }
  }

  return { findings, covered };
}

// ---------------------------------------------------------------------------
// Anglicisms and calques
// ---------------------------------------------------------------------------

/**
 * English structures that survive translation into Polish.
 *
 * Written as folded literals rather than regexes so they match accent-blind,
 * and so the reported span keeps the original spelling.
 *
 * ---------------------------------------------------------------------------
 * WHEN A REPLACEMENT MAY BE APPLIED AUTOMATICALLY
 * ---------------------------------------------------------------------------
 * `safe: true` means the replacement can be substituted in place and the
 * sentence stays grammatical. That is a much stronger condition than "the
 * replacement means the same thing", and the only reliable test is *case
 * government*: the old phrase and the new one must demand the same case of
 * whatever follows them, and belong to the same syntactic category.
 *
 * Getting this wrong is silent and destructive. Two examples that were in this
 * table and are not any more:
 *
 *   "W celu otwarcia drzwi"  -> "aby otwarcia drzwi"     (broken)
 *       "w celu" governs the genitive of a verbal noun; "aby" needs an
 *       infinitive. Converting one into the other means re-inflecting the
 *       verb, which a substitution cannot do.
 *
 *   "Bazując na twoich ustawieniach" -> "na podstawie twoich ustawieniach"
 *       "bazując na" governs the locative, "na podstawie" the genitive, so the
 *       trailing noun keeps the wrong ending. (Correct: "...twoich ustawień".)
 *
 * Both are reported as hints instead. A tool that quietly produces broken
 * Polish is worse than one that stays quiet, because the translator has no
 * reason to re-read a sentence the tool claims to have fixed.
 *
 * What *is* safe, and why:
 *   - pleonasm removal -- "swój własny" -> "własny". Deleting a redundant word
 *     cannot change the case of anything around it.
 *   - adverbial phrase -> adverb -- "w dniu dzisiejszym" -> "dzisiaj". Neither
 *     side governs a following word.
 *   - clause introducer -> clause introducer -- "z uwagi na fakt, że" ->
 *     "ponieważ". The clause itself is left untouched, and both take a full
 *     clause.
 *   - same-case swaps -- "posiadać konto" -> "mieć konto" (both accusative).
 *
 * ---------------------------------------------------------------------------
 * ENTRIES ARE OBJECTS, AND `phrase` MUST ALREADY BE FOLDED
 * ---------------------------------------------------------------------------
 * Two mistakes are easy to make here and both fail *silently* -- the entry
 * simply never matches, so nothing is reported and nothing looks wrong:
 *
 *   1. Writing `phrase` with diacritics. Matching happens against folded text,
 *      so "swój własny" can never be found in "To jest swój własny wybór"
 *      (which folds to "to jest swoj wlasny wybor"). Write "swoj wlasny".
 *   2. Writing a phrase in only one inflection. "wracać z powrotem" as a key
 *      misses "Wróć z powrotem", which is the phrase translators actually
 *      write. Entries are therefore generated across inflections rather than
 *      hand-listed, because hand-listing is how a form goes missing.
 *
 * A test asserts every `phrase` equals its own `fold()`.
 */

/** @typedef {{ phrase: string, replacement: string, note: string, safe?: boolean, keepHead?: number }} Calque */

/** @type {Calque[]} */
const CALQUES = [
  // -- safe: pleonasm, the redundant word is simply dropped
  { phrase: 'swoj wlasny', replacement: 'własny', note: 'redundancja: „swój własny"', safe: true },
  { phrase: 'wlasny swoj', replacement: 'własny', note: 'redundancja: „własny swój"', safe: true },
  { phrase: 'nowa innowacja', replacement: 'innowacja', note: 'redundancja', safe: true },
  { phrase: 'nowe innowacje', replacement: 'innowacje', note: 'redundancja', safe: true },
  { phrase: 'faktycznie w rzeczywistosci', replacement: 'w rzeczywistości', note: 'redundancja', safe: true },

  // -- safe: adverbial phrase -> adverb, nothing follows to re-inflect
  { phrase: 'w dniu dzisiejszym', replacement: 'dzisiaj', note: 'kalka urzędowa „today"', safe: true },
  { phrase: 'na chwile obecna', replacement: 'obecnie', note: 'kalka urzędowa „at present"', safe: true },
  { phrase: 'na koncu dnia', replacement: 'ostatecznie', note: 'kalka „at the end of the day"', safe: true },
  { phrase: 'w zwiazku z powyzszym', replacement: 'dlatego', note: 'kalka urzędowa', safe: true },

  // -- safe: clause introducer -> clause introducer, clause left intact
  { phrase: 'z uwagi na fakt, ze', replacement: 'ponieważ', note: 'kalka „due to the fact that"', safe: true },
  { phrase: 'z uwagi na fakt ze', replacement: 'ponieważ', note: 'kalka „due to the fact that"', safe: true },
  { phrase: 'w zwiazku z faktem, ze', replacement: 'ponieważ', note: 'kalka „due to the fact that"', safe: true },
  { phrase: 'w zwiazku z faktem ze', replacement: 'ponieważ', note: 'kalka „due to the fact that"', safe: true },
  { phrase: 'w momencie gdy', replacement: 'gdy', note: 'kalka „at the moment when"', safe: true },
  { phrase: 'w momencie, gdy', replacement: 'gdy', note: 'kalka „at the moment when"', safe: true },
  { phrase: 'w przypadku gdy', replacement: 'gdy', note: 'kalka „in the case when"', safe: true },

  // -- safe: both sides govern the same case
  { phrase: 'posiadac', replacement: 'mieć', note: '„posiadać" brzmi urzędowo; oba łączą się z biernikiem', safe: true },
  { phrase: 'podjac decyzje', replacement: 'zdecydować', note: 'kalka „to make a decision"', safe: true },
  { phrase: 'podejmij decyzje', replacement: 'zdecyduj', note: 'kalka „to make a decision"', safe: true },
  { phrase: 'podejmowanie decyzji', replacement: 'decydowanie', note: 'kalka „decision making"', safe: true },

  // -- safe: adverb -> adverb, same meaning
  { phrase: 'finalnie', replacement: 'ostatecznie', note: 'kalka „finally"', safe: true },
  { phrase: 'aktualnie', replacement: 'obecnie', note: '„actually" to „właściwie"; „aktualnie" = „obecnie"', safe: true },

  // -- safe: adjective -> adjective, agrees in gender
  { phrase: 'dedykowany', replacement: 'przeznaczony', note: '„dedicated" — nadużywane', safe: true },
  { phrase: 'dedykowana', replacement: 'przeznaczona', note: '„dedicated" — nadużywane', safe: true },
  { phrase: 'dedykowane', replacement: 'przeznaczone', note: '„dedicated" — nadużywane', safe: true },

  // -- safe: infinitive -> infinitive, same government
  { phrase: 'generowac', replacement: 'tworzyć', note: 'kalka „to generate"', safe: true },
  { phrase: 'mapowac', replacement: 'przypisywać', note: 'żargon „to map"', safe: true },
  { phrase: 'managowac', replacement: 'zarządzać', note: 'żargon „to manage"', safe: true },
  { phrase: 'priorytetyzowac', replacement: 'ustalać priorytety', note: 'żargon „to prioritize"', safe: true },
  { phrase: 'inkorporowac', replacement: 'włączyć', note: 'kalka „to incorporate"', safe: true },
  { phrase: 'implementowac', replacement: 'wdrożyć', note: 'żargon „to implement"', safe: true },
  { phrase: 'optymalizowac', replacement: 'usprawnić', note: 'żargon „to optimize"', safe: true },

  // -- hints only: the replacement needs the sentence rebuilt.
  //    Either the case government differs, or the phrase must be re-inflected.
  { phrase: 'w celu', replacement: 'aby + bezokolicznik', note: '„in order to": „w celu" łączy się z dopełniaczem, „aby" z bezokolicznikiem' },
  { phrase: 'bazujac na', replacement: 'na podstawie + dopełniacz', note: '„based on": „bazując na" łączy się z miejscownikiem, „na podstawie" z dopełniaczem' },
  { phrase: 'bazowany na', replacement: 'oparty na', note: '„based on" — kalka' },
  { phrase: 'bazowana na', replacement: 'oparta na', note: '„based on" — kalka' },
  { phrase: 'bazowane na', replacement: 'oparte na', note: '„based on" — kalka' },
  { phrase: 'w oparciu o', replacement: 'na podstawie + dopełniacz', note: '„based on" — zmiana przypadka' },
  { phrase: 'za pomoca', replacement: 'przez + biernik', note: '„by means of" — zmiana przypadka' },
  { phrase: 'za posrednictwem', replacement: 'przez + biernik', note: '„via" — zmiana przypadka' },
  { phrase: 'w ramach', replacement: 'w + biernik / podczas', note: '„within the framework of" — zmiana przypadka' },
  { phrase: 'miec mozliwosc', replacement: 'móc + bezokolicznik', note: '„to have the ability to" — wymaga bezokolicznika' },
  { phrase: 'eventualnie', replacement: 'być może', note: '„eventually" znaczy „w końcu"; „eventualnie" to „być może" — zmiana znaczenia' },
  { phrase: 'konsekwentnie', replacement: 'kolejno / spójnie', note: '„consistently" — zależy od kontekstu' },
  { phrase: 'adresowac', replacement: 'rozwiązać / zająć się', note: '„to address" — po polsku problemów się nie adresuje' },
  { phrase: 'adresujemy', replacement: 'rozwiązać / zająć się', note: '„to address" — kalka' },
  { phrase: 'adresuje', replacement: 'rozwiązać / zająć się', note: '„to address" — kalka' },
  { phrase: 'kontrolowac', replacement: 'sterować', note: '„to control" w UI to „sterowanie"' },
  { phrase: 'aplikowac', replacement: 'stosować', note: '„to apply" — po polsku aplikuje się o pracę' },
  { phrase: 'wspierac', replacement: 'obsługiwać', note: '„to support" — technicznie „obsługiwać"' },
  { phrase: 'wsparcie dla', replacement: 'obsługa', note: '„support for" — kalka' },
  { phrase: 'lokalizacja', replacement: 'położenie', note: '„location" — „lokalizacja" tylko o tłumaczeniach' },
  { phrase: 'zalokowany', replacement: 'umieszczony', note: '„located" — kalka' },
  { phrase: 'realizowac', replacement: 'wykonać', note: '„to realize/implement" — żargon' },
  { phrase: 'dedykowany dla', replacement: 'przeznaczony dla', note: '„dedicated to" — nadużywane' },
];

/**
 * Periphrasis for "to do/make X" -- the most common English calque in Polish UI
 * text, and the one most likely to be written in a form the table forgets.
 *
 * Generated as a cross product rather than hand-listed: listing it by hand is
 * how the infinitive "dokonać zakupu" came to be caught while the imperative
 * "Dokonaj zakupu" was missed.
 *
 * All hint-only. "dokonać zakupu mikstury" cannot become "kupić mikstury" --
 * the object would need the accusative ("kupić miksturę"), so substituting the
 * phrase alone leaves the noun with the wrong ending.
 */
const DO_MADE = [
  'dokonac', 'dokonaj', 'dokonajcie', 'dokonajmy', 'dokonuje', 'dokonujesz',
  'dokonujemy', 'dokonuja', 'dokonal', 'dokonala', 'dokonali', 'dokonano',
  'dokonywac', 'dokonywal', 'dokonywali',
];
const MADE_THINGS = [
  ['zakupu', 'kupić'],
  ['wyboru', 'wybrać'],
  ['zmiany', 'zmienić'],
  ['rezerwacji', 'zarezerwować'],
  ['platnosci', 'zapłacić'],
  ['instalacji', 'zainstalować'],
  ['aktualizacji', 'zaktualizować'],
  ['konfiguracji', 'skonfigurować'],
];

for (const verb of DO_MADE) {
  for (const [noun, replacement] of MADE_THINGS) {
    CALQUES.push({
      phrase: `${verb} ${noun}`,
      replacement,
      note: `omówienie „to make a ${noun}" — wystarczy sam czasownik`,
    });
  }
}

/**
 * Pleonasm: a verb that already contains the meaning of a trailing adverb.
 *
 * Matched as "the tail, plus the word immediately before it", where that word
 * must be an inflection of the verb. The tail alone is never the key --
 * "z powrotem" is correct in "tam i z powrotem" (back and forth), and "razem"
 * is usually just "together".
 *
 * Inflections are recognised as *stem + ending* rather than listed. The first
 * version of this table listed forms by hand and caught "Wracam z powrotem"
 * while missing "Wróć z powrotem" -- which is the phrase translators actually
 * write. Stem plus a closed set of endings covers every form at once.
 *
 * The fix keeps the matched verb and drops the tail, so it is
 * inflection-preserving by construction. Substituting a fixed string would turn
 * "Wróć z powrotem" into "wracać": wrong person, mood and number.
 */
const PLEONASM = [
  {
    tail: 'z powrotem',
    stems: ['wrac', 'wroc'],
    note: 'redundancja: „wracać" już znaczy „z powrotem"',
  },
  {
    tail: 'razem',
    stems: ['lacz', 'polacz', 'wspolpracow', 'wspolpracuj'],
    note: 'redundancja: „łączyć" już znaczy „razem"',
  },
  {
    tail: 'do tylu',
    stems: ['cof', 'cofn'],
    // "cofnij się do tyłu" -- the verb is two words back, behind the reflexive.
    reflexive: 'sie',
    note: 'redundancja: „cofać się" już znaczy „do tyłu"',
  },
];

/**
 * Verb endings that may follow a stem.
 *
 * A closed list, not a heuristic: it has to reject "Wrocław" (stem "wroc" +
 * "law"), "łączki" (stem "lacz" + "ki") and "łącznie" (stem "lacz" + "nie"),
 * all of which are real words that must not be mistaken for a verb.
 */
const VERB_ENDINGS = new Set([
  // infinitive
  '', 'ac', 'ec', 'ic', 'uc', 'yc', 'c', 'sc', 'zc',
  // present
  'e', 'esz', 'emy', 'ecie', 'eja',
  'i', 'isz', 'imy', 'icie', 'ia', 'ie',
  'a', 'asz', 'amy', 'acie', 'aja',
  'y', 'ysz', 'ymy', 'ycie', 'yja',
  'uje', 'ujesz', 'ujemy', 'ujecie', 'uja',
  'am', 'em', 'im', 'ym',
  // imperative
  'aj', 'ej', 'ij', 'yj', 'uj', 'cz', 'dz', 'sz',
  'ajcie', 'ejcie', 'ijcie', 'yjcie', 'ujcie',
  'ajmy', 'ejmy', 'ijmy', 'yjmy', 'ujmy',
  'my', 'cie',
  // past
  'al', 'el', 'il', 'yl', 'ul', 'ol',
  'ala', 'ela', 'ila', 'yla', 'ola',
  'alo', 'elo', 'ilo', 'ylo', 'olo',
  'ali', 'eli', 'ili', 'yli', 'oli',
  'aly', 'ely', 'ily', 'yly', 'oly',
  'alem', 'elam', 'ilam', 'ylam', 'alam', 'elem', 'ilem', 'ylem',
  'alismy', 'elismy', 'ilismy', 'ylismy',
  'alysmy', 'elysmy', 'ilysmy', 'ylysmy',
  // participles and remaining forms
  'l', 'la', 'lo', 'li', 'ly', 'lem', 'lam', 'lismy', 'lysmy',
  'ny', 'na', 'ne', 'ni',
]);

/** True when `word` (already folded and lower-cased) is an inflection of one of `stems`. */
function isVerbForm(word, stems) {
  return stems.some(
    (stem) => word.startsWith(stem) && VERB_ENDINGS.has(word.slice(stem.length)),
  );
}

/** The word ending just before `position`, or null. Indices are in `folded`. */
function wordBefore(folded, position) {
  let end = position;
  while (end > 0 && /\s/.test(folded[end - 1])) end -= 1;
  let start = end;
  while (start > 0 && /\p{L}/u.test(folded[start - 1])) start -= 1;
  return start === end ? null : { start, end };
}

/** Find pleonasms, reporting the verb together with its redundant tail. */
function findPleonasms(text) {
  const folded = fold(text);
  const lower = folded.toLowerCase();
  const found = [];

  for (const entry of PLEONASM) {
    const { tail, stems, reflexive, note } = entry;
    let from = 0;

    for (;;) {
      const at = lower.indexOf(tail, from);
      if (at === -1) break;
      from = at + tail.length;

      // The tail must stand alone.
      const before = at === 0 ? '' : folded[at - 1];
      const after = at + tail.length >= folded.length ? '' : folded[at + tail.length];
      if (/[\p{L}\p{N}]/u.test(before)) continue;
      if (/[\p{L}\p{N}]/u.test(after)) continue;

      // The word in front of the tail is the verb, or the reflexive particle
      // when the verb is reflexive. Indices are in the folded string, which is
      // the same length as the original, so they can be used to slice the
      // original and keep its spelling.
      let head = wordBefore(folded, at);
      if (!head) continue;

      // Where the kept part ends: after the verb, or after the reflexive that
      // belongs to it. Dropping the reflexive would turn "Cofnij się do tyłu"
      // into "Cofnij", which is a different verb.
      let keepEnd = head.end;
      let verb = head;

      if (reflexive) {
        if (lower.slice(head.start, head.end) !== reflexive) continue;
        verb = wordBefore(folded, head.start);
        if (!verb) continue;
      }

      if (!isVerbForm(lower.slice(verb.start, verb.end), stems)) continue;

      const span = text.slice(verb.start, at + tail.length);

      found.push({
        span,
        index: verb.start,
        length: span.length,
        // The verb in its original spelling, so the fix drops only the tail.
        replacement: text.slice(verb.start, keepEnd),
        note,
        safe: true,
      });
    }
  }

  return found;
}

/**
 * Folded literal search with word boundaries.
 *
 * Phrases are sorted longest-first so "dedykowany dla" wins over "dedykowany":
 * reporting both would show two overlapping corrections for one span.
 */
function findCalques(text) {
  const folded = fold(text);
  const lowerFolded = folded.toLowerCase();
  const found = [];

  const ordered = [...CALQUES].sort((a, b) => b.phrase.length - a.phrase.length);

  for (const calque of ordered) {
    const needle = calque.phrase;
    let from = 0;

    for (;;) {
      const index = lowerFolded.indexOf(needle, from);
      if (index === -1) break;
      from = index + needle.length;

      // Word-boundary guard: a letter or digit on either side means this is
      // part of a longer word, not the phrase.
      const before = index === 0 ? '' : folded[index - 1];
      const after = index + needle.length >= folded.length ? '' : folded[index + needle.length];
      if (/[\p{L}\p{N}]/u.test(before)) continue;
      if (/[\p{L}\p{N}]/u.test(after)) continue;

      // A longer phrase already covering this span wins.
      const overlaps = found.some(
        (item) => index < item.index + item.length && index + needle.length > item.index,
      );
      if (overlaps) continue;

      // The original spelling, so the report reads correctly.
      const span = text.slice(index, index + needle.length);

      found.push({
        span,
        index,
        length: needle.length,
        replacement: applyCase(calque.replacement, span),
        note: calque.note,
        safe: Boolean(calque.safe),
      });
    }
  }

  return found.sort((a, b) => a.index - b.index);
}

/** Every calque-like finding: literal phrases plus inflected pleonasms. */
function findAllCalques(text) {
  return [...findCalques(text), ...findPleonasms(text)].sort((a, b) => a.index - b.index);
}

// ---------------------------------------------------------------------------
// Passive voice
// ---------------------------------------------------------------------------

const PASSIVE = [
  [/\bzostał[aiy]?\s+\w+(?:ny|ty|ony|any|ity)\b/gi, 'Został otwarty → Otworzył się'],
  [/\bzostali\s+\w+(?:ni|ci|eni|ani|ici)\b/gi, 'Zostali pokonani → Pokonaliśmy ich'],
  [/\bzostały\s+\w+(?:ne|te|one|ane|ity)\b/gi, 'Zostały dodane → Dodano'],
  [/\bjest\s+\w+(?:ny|ty|ony|any|ity)\s+przez\b/gi, 'jest robiony przez → robi'],
  [/\bsą\s+\w+(?:ne|te|one|ane|ite)\s+przez\b/gi, 'są robione przez → robią'],
  [/\bbył[aiy]?\s+\w+(?:ny|ty|ony|any|ity)\s+przez\b/gi, 'był robiony przez → zrobił'],
  [/\bbyły\s+\w+(?:ne|te|one|ane)\s+przez\b/gi, 'były robione przez → zrobili'],
];

// ---------------------------------------------------------------------------
// English left behind
// ---------------------------------------------------------------------------

/** English function words. Presence of several means the text is not Polish. */
const ENGLISH_MARKERS = new Set([
  'the', 'and', 'you', 'your', 'yours', 'is', 'are', 'was', 'were', 'will',
  'would', 'can', 'could', 'should', 'shall', 'of', 'to', 'in', 'on', 'at',
  'with', 'for', 'from', 'this', 'that', 'these', 'those', 'it', 'its', 'as',
  'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'not',
  'but', 'or', 'if', 'then', 'than', 'when', 'where', 'which', 'who', 'what',
  'how', 'all', 'any', 'some', 'no', 'yes', 'get', 'got', 'make', 'made',
  'take', 'took', 'use', 'used', 'need', 'want', 'see', 'look', 'find', 'give',
  'go', 'come', 'know', 'think', 'say', 'tell', 'work', 'help', 'show', 'play',
  'run', 'move', 'turn', 'open', 'close', 'start', 'stop', 'save', 'load',
  'new', 'old', 'first', 'last', 'next', 'back', 'more', 'less', 'up', 'down',
  'out', 'over', 'under', 'again', 'here', 'there', 'now', 'never', 'always',
  'about', 'into', 'through', 'between', 'before', 'after', 'during', 'while',
  'because', 'so', 'very', 'too', 'also', 'only', 'just', 'still', 'even',
  'left', 'right', 'level', 'power', 'health', 'damage', 'score', 'total',
]);

/**
 * Tokens that are legitimately shared between Polish and English, or are
 * universal in game UI, so their presence is not evidence of a missing
 * translation.
 */
const SHARED_TOKENS = new Set([
  'ok', 'hp', 'mp', 'xp', 'max', 'min', 'pro', 'premium', 'level', 'boss',
  'dlc', 'demo', 'beta', 'alpha', 'online', 'offline', 'spawn', 'respawn',
  'loot', 'skin', 'build', 'patch', 'update', 'bug', 'chat', 'lobby', 'quest',
  'team', 'solo', 'coop', 'mod', 'mods', 'item', 'items', 'player', 'game',
  'menu', 'start', 'stop', 'go', 'no', 'yes', 'add', 'new', 'set', 'all',
  'pro', 'plus', 'air', 'app', 'art', 'auto', 'best', 'bit', 'box', 'code',
  'data', 'date', 'day', 'end', 'error', 'event', 'file', 'final', 'free',
  'full', 'id', 'info', 'list', 'live', 'log', 'map', 'mode', 'name', 'net',
  'open', 'order', 'pack', 'part', 'pass', 'path', 'plan', 'point', 'post',
  'rate', 'real', 'role', 'room', 'save', 'side', 'site', 'size', 'star',
  'state', 'step', 'test', 'text', 'time', 'top', 'type', 'unit', 'user',
  'view', 'war', 'wave', 'zone',
]);

function englishMarkersIn(text) {
  const words = String(text).toLowerCase().match(/[a-z][a-z']{1,}/g) ?? [];
  const found = new Set();
  for (const word of words) {
    if (SHARED_TOKENS.has(word)) continue;
    if (ENGLISH_MARKERS.has(word)) found.add(word);
  }
  return [...found];
}

// ---------------------------------------------------------------------------
// Punctuation and typography
// ---------------------------------------------------------------------------

function typographyFindings(text) {
  const findings = [];

  // Polish quotation marks are „…”, not the English "...".
  const straightQuotes = text.match(/"[^"\n]{2,}"/);
  if (straightQuotes) {
    findings.push({
      code: 'quotes',
      severity: SEVERITY.INFO,
      message: `Prosty cudzysłów zamiast polskiego „…”`,
      detail: 'W polskim tekście używa się „…”. Jeśli to string w kodzie, zignoruj.',
      fix: {
        kind: 'replace',
        from: straightQuotes[0],
        to: `„${straightQuotes[0].slice(1, -1)}”`,
      },
      match: straightQuotes[0],
    });
  }

  // Space before punctuation is a French convention, wrong in Polish.
  const spaceBefore = text.match(/\s+[,.;:!?](?=\s|$)/);
  if (spaceBefore) {
    findings.push({
      code: 'space-before-punctuation',
      severity: SEVERITY.WARNING,
      message: 'Spacja przed znakiem interpunkcyjnym',
      detail: 'W polskim nie stawia się spacji przed przecinkiem, kropką ani średnikiem.',
      fix: { kind: 'pattern', from: /\s+([,.;:!?])(?=\s|$)/g, to: '$1' },
      match: spaceBefore[0],
    });
  }

  // Missing space after sentence punctuation.
  const missingSpace = text.match(/[a-ząćęłńóśźż][.!?][A-ZĄĆĘŁŃÓŚŹŻ]/);
  if (missingSpace) {
    findings.push({
      code: 'missing-space',
      severity: SEVERITY.WARNING,
      message: `Brak spacji po znaku interpunkcyjnym w „${missingSpace[0]}"`,
      fix: { kind: 'pattern', from: /([.!?])([A-ZĄĆĘŁŃÓŚŹŻ])/g, to: '$1 $2' },
      match: missingSpace[0],
    });
  }

  // English Title Case carried over. Requires most words capitalised AND a
  // reasonable number of them, because a short game string legitimately
  // capitalises ("Nowy Świat" is a place name).
  const words = text.trim().split(/\s+/).filter((word) => /^[\p{L}]/u.test(word));
  if (words.length >= 5) {
    const capitalised = words.filter((word) => /^\p{Lu}/u.test(word)).length;
    if (capitalised / words.length >= 0.8) {
      findings.push({
        code: 'title-case',
        severity: SEVERITY.INFO,
        message: 'Każde słowo wielką literą — to angielski Title Case',
        detail: 'W polskim zdaniu wielką literą pisze się tylko pierwsze słowo i nazwy własne.',
        match: text.trim().slice(0, 60),
      });
    }
  }

  // Hyphen used where Polish wants an en dash (ranges: 10-20 -> 10–20).
  const hyphenRange = text.match(/\b\d+\s*-\s*\d+\b/);
  if (hyphenRange) {
    findings.push({
      code: 'hyphen-range',
      severity: SEVERITY.INFO,
      message: `Zakres zapisany dywizem: „${hyphenRange[0]}"`,
      detail: 'Zakresy liczbowe zapisuje się półpauzą: 10–20.',
      fix: { kind: 'replace', from: hyphenRange[0], to: hyphenRange[0].replace(/\s*-\s*/, '–') },
      match: hyphenRange[0],
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Style
// ---------------------------------------------------------------------------

/** Second-person singular markers ("you" as a friend). */
const INFORMAL = /\b(twój|twoja|twoje|twoich|twoim|ciebie|cię|masz|możesz|jesteś|zrób|idź|weź|daj|chcesz|wiesz|widzisz|musisz|powinieneś)\b/gi;

/** Formal address markers ("you" as Pan/Pani, or impersonal). */
const FORMAL = /\b(Pański|Pańska|Pańskie|Pana|Pani|Państwa|proszę|należy|uprzejmie|użytkownik)\b/g;

function styleFindings(text, source) {
  const findings = [];

  // Formality mixing: both registers in one string reads as broken.
  const informal = text.match(INFORMAL) ?? [];
  const formal = text.match(FORMAL) ?? [];
  if (informal.length > 0 && formal.length > 0) {
    findings.push({
      code: 'formality-mixed',
      severity: SEVERITY.WARNING,
      message: 'Mieszana forma — raz „ty", raz „Pan/Pani"',
      detail: `Nieformalne: ${[...new Set(informal.map((word) => word.toLowerCase()))].join(', ')}. Formalne: ${[...new Set(formal)].join(', ')}.`,
      match: [...informal, ...formal].slice(0, 3).join(', '),
    });
  }

  // Repeated word, the classic "the the".
  const repeated = text.match(/\b(\w{3,})\s+\1\b/i);
  if (repeated) {
    findings.push({
      code: 'repeated-word',
      severity: SEVERITY.WARNING,
      message: `Powtórzone słowo: „${repeated[0]}"`,
      fix: { kind: 'pattern', from: /\b(\w{3,})\s+\1\b/gi, to: '$1' },
      match: repeated[0],
    });
  }

  // Verbosity: Polish runs longer than English, but not by this much. A ratio
  // above ~1.9 usually means a phrase expanded into a clause.
  if (source && source.trim().length > 12) {
    const ratio = text.trim().length / source.trim().length;
    if (ratio > 1.9) {
      findings.push({
        code: 'verbose',
        severity: SEVERITY.INFO,
        message: `Tłumaczenie jest ${Math.round((ratio - 1) * 100)}% dłuższe od źródła`,
        detail: 'Polski jest zwykle dłuższy o 15–30%. Dużo więcej oznacza rozwlekłość — skróć.',
        match: `${text.trim().length} vs ${source.trim().length} znaków`,
      });
    }
  }

  // Chains of verbal nouns: "wprowadzanie ustawień powoduje..." reads like a
  // manual translated by someone who hates verbs.
  const nounChain = text.match(/\b\w{5,}(?:anie|enie)\s+\w{5,}(?:ania|enia)\b/i);
  if (nounChain) {
    findings.push({
      code: 'noun-chain',
      severity: SEVERITY.INFO,
      message: `Łańcuch rzeczowników odczasownikowych: „${nounChain[0]}"`,
      detail: 'Zamień jeden z nich na czasownik — brzmi naturalniej.',
      match: nounChain[0],
    });
  }

  // An exclamation or question mark pile-up, usually an MT artefact.
  const punctuationPile = text.match(/[!?]{2,}/);
  if (punctuationPile) {
    findings.push({
      code: 'punctuation-pile',
      severity: SEVERITY.INFO,
      message: `Nadmiar znaków: „${punctuationPile[0]}"`,
      fix: { kind: 'pattern', from: /([!?])\1+/g, to: '$1' },
      match: punctuationPile[0],
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Score a list of findings, 0..100.
 *
 * Exported because a caller that filters findings -- the Overview tab, once the
 * translator has ignored a correction -- needs to score the *surviving* list.
 * Ignoring a correction has to lift the score, or the number keeps punishing a
 * judgement that has already been made.
 */
export function scoreFromFindings(findings = []) {
  let score = 100;

  for (const finding of findings) {
    const penalty = PENALTY[finding.severity];

    // A finding without a valid severity is a bug in this module, not bad
    // input. Throwing beats quietly substituting a default penalty: silently
    // under-scoring is precisely how the FINDING/SEVERITY casing mismatch went
    // unnoticed, and a wrong score is harder to spot than a stack trace.
    if (penalty === undefined) {
      throw new Error(
        `naturalness: finding "${finding.code}" has invalid severity ${JSON.stringify(finding.severity)}`,
      );
    }

    score -= penalty;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Assess one piece of target text.
 *
 * `options.source` is used for the verbosity ratio; `options.language` gates the
 * Polish-specific checks so the function stays honest for other targets (they
 * simply get fewer findings rather than wrong ones).
 */
export function assessNaturalness(target, options = {}) {
  const text = String(target ?? '');
  const source = options.source ?? '';
  const language = (options.language ?? 'pl').toLowerCase().split('-')[0];

  if (text.trim() === '') {
    return { score: null, findings: [], metrics: { characters: 0, words: 0, ratio: null } };
  }

  const findings = [];
  const polish = language === 'pl';

  if (polish) {
    // Numerals run first: their spans tell the diacritics check which words to
    // leave alone, because "3 punktow" needs the numeral rule, not a diacritic
    // restoration.
    const numerals = numeralFindings(text);
    findings.push(...numerals.findings);

    const coveredByNumeral = (index) =>
      numerals.covered.some(([start, end]) => index >= start && index < end);

    // ---- missing diacritics
    const misspelt = [];
    const wordPattern = /[\p{L}]{3,}/gu;
    for (const match of text.matchAll(wordPattern)) {
      const word = match[0];
      if (!isMisspelt(word)) continue;
      if (coveredByNumeral(match.index)) continue;
      misspelt.push({ word, fixed: restoreDiacritics(word) });
    }

    if (misspelt.length > 0) {
      const unique = [...new Map(misspelt.map((item) => [item.word, item])).values()];
      findings.push({
        code: 'missing-diacritics',
        severity: SEVERITY.ERROR,
        message: `Brak polskich znaków: ${unique.slice(0, 6).map((item) => `„${item.word}" → „${item.fixed}"`).join(', ')}${unique.length > 6 ? ` i ${unique.length - 6} więcej` : ''}`,
        detail: 'Tekst bez ogonków czyta się jak zepsuty. To najczęstszy błąd w polskich tłumaczeniach.',
        fix: {
          kind: 'pattern',
          apply: (value) =>
            value.replace(/[\p{L}]{3,}/gu, (word) => (isMisspelt(word) ? restoreDiacritics(word) ?? word : word)),
        },
        match: unique.map((item) => item.word).slice(0, 3).join(', '),
        items: unique,
      });
    }

    // ---- English left behind
    const english = englishMarkersIn(text);
    if (english.length >= 2) {
      findings.push({
        code: 'english-leftover',
        severity: SEVERITY.ERROR,
        message: `Angielskie słowa w tłumaczeniu: ${english.slice(0, 6).join(', ')}`,
        detail: 'Ten fragment nie został przetłumaczony.',
        match: english.slice(0, 3).join(', '),
      });
    }

    // ---- calques and periphrasis
    for (const calque of findAllCalques(text)) {
      findings.push({
        code: 'calque',
        severity: SEVERITY.WARNING,
        message: `„${calque.span}" → „${calque.replacement}"`,
        detail: calque.note,
        // Only a self-contained phrase gets an automatic fix. Anything else is
        // a hint, because substituting it would break the sentence.
        fix: calque.safe ? { kind: 'replace', from: calque.span, to: calque.replacement } : undefined,
        match: calque.span,
        hint: !calque.safe,
      });
    }

    // ---- passive voice
    for (const [pattern, example] of PASSIVE) {
      pattern.lastIndex = 0;
      const match = text.match(pattern);
      if (!match) continue;
      findings.push({
        code: 'passive',
        severity: SEVERITY.INFO,
        message: `Strona bierna: „${match[0]}"`,
        detail: `Po polsku zwykle brzmi to ciężej niż potrzeba. Np. ${example}.`,
        match: match[0],
      });
    }
  }

  findings.push(...typographyFindings(text));
  findings.push(...styleFindings(text, source));

  const score = scoreFromFindings(findings);

  const words = text.trim().split(/\s+/).filter(Boolean).length;

  return {
    score,
    findings,
    metrics: {
      characters: text.length,
      words,
      ratio: source.trim() ? Number((text.trim().length / source.trim().length).toFixed(2)) : null,
    },
  };
}

/** A short label for a score, for the UI. */
export function scoreLabel(score) {
  if (score === null || score === undefined) return { label: 'brak tekstu', tone: 'faint' };
  if (score >= 90) return { label: 'naturalne', tone: 'ok' };
  if (score >= 75) return { label: 'dobre', tone: 'ok' };
  if (score >= 55) return { label: 'do poprawy', tone: 'warn' };
  return { label: 'brzmi tłumaczalnie', tone: 'err' };
}

/**
 * Apply a finding's fix to a string, when it has a mechanical one.
 * Returns null when there is nothing to apply -- which is the honest answer for
 * a hint-only finding.
 */
export function applyFix(text, finding) {
  const fix = finding?.fix;
  if (!fix) return null;

  if (fix.kind === 'pattern') {
    const next = typeof fix.apply === 'function' ? fix.apply(text) : text.replace(fix.from, fix.to);
    return next === text ? null : next;
  }

  if (fix.kind === 'replace') {
    const index = text.indexOf(fix.from);
    if (index === -1) return null;
    const next = text.slice(0, index) + fix.to + text.slice(index + fix.from.length);
    return next === text ? null : next;
  }

  return null;
}

/**
 * Apply every mechanical fix, in a single pass.
 *
 * Order matters: the diacritics fix is a whole-string transform and the others
 * are literal replacements, so diacritics go last. Otherwise a replacement
 * introduces a word that the diacritics pass then has to re-scan, and the
 * reported spans no longer line up.
 */
export function applyAllFixes(text, findings = []) {
  let current = text;
  const applied = [];

  const mechanical = findings.filter((finding) => finding.fix && finding.code !== 'missing-diacritics');
  const diacritics = findings.find((finding) => finding.code === 'missing-diacritics');

  for (const finding of mechanical) {
    const next = applyFix(current, finding);
    if (next === null || next === current) continue;
    current = next;
    applied.push(finding.code);
  }

  if (diacritics) {
    const next = applyFix(current, diacritics);
    if (next !== null && next !== current) {
      current = next;
      applied.push('missing-diacritics');
    }
  }

  return { text: current, applied };
}

export { DIACRITICS, COUNTABLE, CALQUES, isMisspelt, restoreDiacritics };
