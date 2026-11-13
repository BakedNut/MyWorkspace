package kr.myworkspace.shortcuts;

import java.util.HashSet;
import java.util.Set;
import kr.myworkspace.common.document.DocumentStore;
import kr.myworkspace.common.error.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class ShortcutService {
  final DocumentStore docs;

  ShortcutService(DocumentStore docs) {
    this.docs = docs;
  }

  ShortcutBoard get() {
    return docs.read("shortcuts", ShortcutBoard.class);
  }

  @Transactional
  ShortcutBoard save(ShortcutBoard input) {
    Set<String> groupIds = new HashSet<>();
    Set<String> linkIds = new HashSet<>();
    var groups =
        input.groups().stream()
            .map(
                group -> {
                  ApiException.require(groupIds.add(group.id()), "분류 ID가 중복되었습니다.");
                  var links =
                      group.links().stream()
                          .map(
                              link -> {
                                ApiException.require(linkIds.add(link.id()), "바로가기 ID가 중복되었습니다.");
                                String url = link.url().strip();
                                try {
                                  ShortcutUrl.origin(url);
                                } catch (IllegalArgumentException error) {
                                  throw new ApiException(400, "VALIDATION", "올바른 사이트 주소를 입력하세요.");
                                }
                                return new ShortcutBoard.Link(link.id(), name(link.name()), url);
                              })
                          .toList();
                  return new ShortcutBoard.Group(
                      group.id(), name(group.name()), group.collapsed(), links);
                })
            .toList();
    ApiException.require(linkIds.size() <= 200, "바로가기는 최대 200개까지 저장할 수 있습니다.");
    var document = docs.lock("shortcuts");
    var current = docs.read(document, ShortcutBoard.class);
    if (input.revision() != current.revision())
      throw new ApiException(409, "CONFLICT", "다른 화면에서 바로가기가 변경됐습니다. 최신 목록을 불러온 뒤 다시 시도하세요.");
    var saved = new ShortcutBoard(current.revision() + 1, groups);
    docs.write(document, saved);
    return saved;
  }

  private String name(String input) {
    String value = input.strip();
    ApiException.require(
        !value.isBlank() && value.codePoints().noneMatch(Character::isISOControl),
        "이름을 줄바꿈 없이 입력하세요.");
    return value;
  }
}
